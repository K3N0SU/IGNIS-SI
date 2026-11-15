"""Multi-criteria fire-hazard ranking of cabin materials across atmospheres.

Three criteria are scored on 0-100 and combined with adjustable weights:

  ignition propensity     how far the atmosphere sits above the material's
                          limiting oxygen concentration, scaled by how easily
                          the material is brought to its ignition temperature;
  toxic CO yield          CO produced per unit mass burned, raised for
                          materials that smoulder and for burning close to
                          the flammability limit, where oxidation is incomplete;
  suppression difficulty  diluent needed to reach the limiting oxygen
                          concentration, plus penalties for deep-seated
                          smouldering and for molten fuel that stays attached
                          in microgravity instead of dripping away.

Material constants are handbook-level values (limiting oxygen index by ASTM
D2863, heats of combustion and CO yields from the SFPE Handbook tables) and
are indicative only. The microgravity shift of the oxygen limit follows the
BASS and Saffire observation that solids burn below their normal-gravity
limit in slow flow.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import exp

MICROGRAVITY_LOI_SHIFT = 2.0  # percentage points of O2
PRESSURE_EXPONENT = 0.12
T_IGNITION_REFERENCE = 550.0  # K


@dataclass(frozen=True)
class Material:
    key: str
    name: str
    use: str
    loi_pct: float  # limiting oxygen index, normal gravity, 1 atm
    heat_of_combustion_mj_kg: float
    co_yield: float  # kg CO per kg burned, well ventilated
    ignition_temperature: float  # K
    smoulders: bool
    melts: bool


@dataclass(frozen=True)
class Atmosphere:
    key: str
    name: str
    x_o2: float
    pressure_atm: float
    description: str

    @property
    def ppo2_atm(self) -> float:
        return self.x_o2 * self.pressure_atm


MATERIALS: dict[str, Material] = {
    m.key: m
    for m in (
        Material("PMMA", "PMMA (acrylic)", "Windows, experiment hardware, reference fuel", 17.3, 25.0, 0.010, 580.0, False, True),
        Material("NOMEX", "Nomex (meta-aramid)", "Crew clothing, cargo bags, thermal blankets", 29.0, 28.0, 0.040, 770.0, True, False),
        Material("COTTON_FIBERGLASS", "Cotton-fiberglass (75/25)", "Saffire reference fabric, towels, clothing", 18.0, 12.5, 0.020, 530.0, True, False),
        Material("SILICONE", "Silicone rubber", "Seals, wire insulation, gaskets", 28.0, 15.0, 0.030, 720.0, True, False),
        Material("KAPTON", "Kapton (polyimide)", "Wire insulation, multilayer insulation", 37.0, 25.0, 0.050, 870.0, True, False),
        Material("PU_FOAM", "Polyurethane foam", "Packing foam, acoustic insulation", 17.5, 26.0, 0.030, 640.0, True, True),
    )
}

ATMOSPHERES: dict[str, Atmosphere] = {
    a.key: a
    for a in (
        Atmosphere("ISS", "ISS cabin", 0.21, 1.00, "21 % O2 at 14.7 psia"),
        Atmosphere("EVA_PREP", "Exploration 10.2 psia", 0.265, 0.694, "26.5 % O2 at 10.2 psia"),
        Atmosphere("ARTEMIS", "Artemis exploration", 0.34, 0.558, "34 % O2 at 8.2 psia"),
    )
}

DEFAULT_WEIGHTS: dict[str, float] = {"ignition": 0.40, "toxicity": 0.25, "suppression": 0.35}


@dataclass(frozen=True)
class RiskEntry:
    rank: int
    material: str
    material_name: str
    atmosphere: str
    atmosphere_name: str
    x_o2: float
    pressure_atm: float
    limiting_o2_pct: float
    oxygen_margin_pct: float
    ignition_propensity: float
    toxic_co_yield: float
    suppression_difficulty: float
    composite: float
    severity: str


def limiting_oxygen_pct(material: Material, pressure_atm: float) -> float:
    """Microgravity limiting O2 (%) at the given pressure.

    Flammability limits track oxygen fraction more closely than partial
    pressure; the weak power law captures the modest rise of the limit as
    total pressure falls.
    """
    return (material.loi_pct - MICROGRAVITY_LOI_SHIFT) * pressure_atm ** (-PRESSURE_EXPONENT)


def _logistic(x: float) -> float:
    return 1.0 / (1.0 + exp(-x))


def score(material: Material, atmosphere: Atmosphere) -> tuple[float, float, float, float, float]:
    limit = limiting_oxygen_pct(material, atmosphere.pressure_atm)
    margin = 100.0 * atmosphere.x_o2 - limit
    flammable = _logistic(margin / 3.0)

    thermal = min(T_IGNITION_REFERENCE / material.ignition_temperature, 1.0)
    ignition = 100.0 * flammable * (0.55 + 0.45 * thermal)

    # CO yield rises as the flame nears its limit and for smouldering fuels.
    near_limit = 1.0 + 1.5 * exp(-max(margin, 0.0) / 4.0)
    effective_yield = material.co_yield * near_limit * (2.5 if material.smoulders else 1.0)
    toxicity = 100.0 * (1.0 - exp(-effective_yield / 0.06)) * (0.35 + 0.65 * flammable)

    dilution = max(1.0 - limit / (100.0 * atmosphere.x_o2), 0.0)
    suppression = 100.0 * min(
        (0.60 * min(dilution / 0.5, 1.0) + 0.22 * material.smoulders + 0.18 * material.melts) * (0.3 + 0.7 * flammable),
        1.0,
    )
    return limit, margin, ignition, toxicity, suppression


def rank(weights: dict[str, float] | None = None) -> list[RiskEntry]:
    w = dict(DEFAULT_WEIGHTS if weights is None else weights)
    total = sum(max(v, 0.0) for v in w.values()) or 1.0
    w = {k: max(v, 0.0) / total for k, v in w.items()}

    rows: list[tuple[float, Material, Atmosphere, tuple[float, float, float, float, float]]] = []
    for material in MATERIALS.values():
        for atmosphere in ATMOSPHERES.values():
            s = score(material, atmosphere)
            composite = w["ignition"] * s[2] + w["toxicity"] * s[3] + w["suppression"] * s[4]
            rows.append((composite, material, atmosphere, s))
    rows.sort(key=lambda r: r[0], reverse=True)

    entries: list[RiskEntry] = []
    for i, (composite, material, atmosphere, s) in enumerate(rows, start=1):
        severity = "CRITICAL" if composite >= 60.0 else "WARNING" if composite >= 35.0 else "NOMINAL"
        entries.append(
            RiskEntry(
                rank=i, material=material.key, material_name=material.name,
                atmosphere=atmosphere.key, atmosphere_name=atmosphere.name,
                x_o2=atmosphere.x_o2, pressure_atm=atmosphere.pressure_atm,
                limiting_o2_pct=round(s[0], 2), oxygen_margin_pct=round(s[1], 2),
                ignition_propensity=round(s[2], 1), toxic_co_yield=round(s[3], 1),
                suppression_difficulty=round(s[4], 1), composite=round(composite, 1), severity=severity,
            )
        )
    return entries


def leaderboard(weights: dict[str, float] | None = None) -> dict[str, object]:
    return {
        "weights": dict(DEFAULT_WEIGHTS if weights is None else weights),
        "entries": [asdict(e) for e in rank(weights)],
        "materials": [asdict(m) for m in MATERIALS.values()],
        "atmospheres": [{**asdict(a), "ppo2_atm": round(a.ppo2_atm, 3)} for a in ATMOSPHERES.values()],
        "basis": "Handbook material constants with a microgravity oxygen-limit shift; indicative ranking, not a qualification test.",
    }

"""ECLSS emergency response protocol derived from the simulated fire state.

Every numerical target is obtained from the same extinction criteria the
solver uses (Da_hot < 1 and Da_cool < 1), searched by bisection over the
controllable atmosphere variable. A response is only reported as effective
when it removes both the hot flame and the cool flame.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .damkohler import damkohler_cool, damkohler_hot
from .droplet import cool_flame_state, hot_flame_state
from .low_flow import critical_reignition_airflow, quasi_steady_hot_state
from .properties import DEFAULT_CALIBRATION, FUELS, Ambient, DiluentKey, FuelKey, ModelCalibration
from .solver import SimulationConfig, SimulationResult

HYPOXIA_PPO2_ATM = 0.16
MODULE_MAX_PRESSURE_ATM = 1.20
# NASA spacecraft maximum allowable concentrations for carbon monoxide (JSC 20584).
CO_SMAC_1H_PPM = 425.0
CO_SMAC_24H_PPM = 100.0
CO_MG_M3_PER_PPM = 1.145  # at 25 C, 1 atm

StepStatus = Literal["REQUIRED", "ADVISORY", "HOLD", "NOT_EFFECTIVE", "NOMINAL"]


@dataclass(frozen=True)
class ProtocolStep:
    order: int
    code: str
    action: str
    status: StepStatus
    rationale: str
    parameters: dict[str, float | str | bool | None] = field(default_factory=dict)


@dataclass(frozen=True)
class Protocol:
    hazard_level: Literal["NOMINAL", "WARNING", "CRITICAL"]
    headline: str
    steps: list[ProtocolStep]


def combustion_sustained(
    fuel_key: FuelKey, ambient: Ambient, diameter: float, velocity: float,
    cal: ModelCalibration = DEFAULT_CALIBRATION,
) -> tuple[bool, bool]:
    """(hot flame viable, cool flame viable) at the given state.

    A hot flame counts as viable if it survives either at the ignition
    standoff or at its relaxed quasi-steady standoff.
    """
    fuel = FUELS[fuel_key]
    kernel = hot_flame_state(fuel, ambient, diameter, cal.ignition_standoff, velocity, cal)
    relaxed = quasi_steady_hot_state(fuel_key, ambient, diameter, velocity, cal)
    hot = min(damkohler_hot(kernel, ambient, velocity, cal), damkohler_hot(relaxed, ambient, velocity, cal)) > 1.0
    cool = fuel.supports_cool_flame and damkohler_cool(cool_flame_state(fuel, ambient, diameter, velocity, cal), velocity, cal) > 1.0
    return hot, cool


def limiting_oxygen(
    fuel_key: FuelKey, pressure_atm: float, diameter: float, diluent: DiluentKey,
    cal: ModelCalibration = DEFAULT_CALIBRATION,
) -> float | None:
    """Highest O2 mole fraction at which neither flame branch is sustained."""

    def burning(x: float) -> bool:
        return any(combustion_sustained(fuel_key, Ambient(x, pressure_atm, diluent=diluent), diameter, 0.0, cal))

    lo, hi = 0.02, 0.40
    if burning(lo):
        return None
    if not burning(hi):
        return hi
    for _ in range(22):
        mid = 0.5 * (lo + hi)
        if burning(mid):
            hi = mid
        else:
            lo = mid
    return lo


def limiting_pressure(
    fuel_key: FuelKey, x_o2: float, diameter: float, diluent: DiluentKey,
    cal: ModelCalibration = DEFAULT_CALIBRATION,
) -> float | None:
    """Highest pressure (atm) at which neither flame branch is sustained."""

    def burning(p: float) -> bool:
        return any(combustion_sustained(fuel_key, Ambient(x_o2, p, diluent=diluent), diameter, 0.0, cal))

    lo, hi = 0.05, 1.5
    if burning(lo):
        return None
    if not burning(hi):
        return hi
    for _ in range(22):
        mid = 0.5 * (lo + hi)
        if burning(mid):
            hi = mid
        else:
            lo = mid
    return lo


def generate_protocol(
    cfg: SimulationConfig, result: SimulationResult, cal: ModelCalibration = DEFAULT_CALIBRATION
) -> Protocol:
    ambient = cfg.ambient
    summary = result.summary
    d0 = cfg.d0_mm * 1e-3
    cool_present = bool(summary["cool_flame_present"])
    reignited = int(summary["reignition_count"] or 0) > 0
    ignited = float(summary["hot_flame_duration_s"] or 0.0) > 0.0

    cool_onsets = [e.t for e in result.events if e.kind == "COOL_FLAME_ONSET"]
    if cool_onsets:
        idx = int(min(range(len(result.t)), key=lambda i: abs(result.t[i] - cool_onsets[0])))
        d_ref = float(result.series["d_mm"][idx]) * 1e-3
    else:
        d_ref = d0
    steps: list[ProtocolStep] = []

    if not ignited:
        return Protocol(
            "NOMINAL",
            "Atmosphere does not sustain ignition of this fuel load",
            [ProtocolStep(1, "MONITOR", "Maintain routine fire-detection monitoring", "NOMINAL",
                          "Da < 1 for both flame branches at the igniter condition.")],
        )

    hidden = cool_present and not reignited
    steps.append(ProtocolStep(
        1, "DETECT",
        "Cross-check UV chemiluminescence and CO/O2 channels; do not clear the alarm on optical evidence",
        "REQUIRED" if cool_present else "ADVISORY",
        (
            f"Visible flame is lost at t = {summary['first_extinction_s']} s but low-temperature burning continues for "
            f"{summary['cool_flame_duration_s']} s with no visible emission."
            if cool_present else
            "Hot flame remains visible throughout; optical and radiometer channels are sufficient."
        ),
        {"cool_flame_duration_s": summary["cool_flame_duration_s"], "first_extinction_s": summary["first_extinction_s"]},
    ))

    u_crit = critical_reignition_airflow(cfg.fuel, ambient, d_ref, cal) if FUELS[cfg.fuel].supports_cool_flame else None
    if reignited:
        vent_status: StepStatus = "REQUIRED"
        vent_text = (
            f"Ventilation at {cfg.airflow_cm_s:.1f} cm/s re-ignited the hot flame at t = {summary['first_reignition_s']} s. "
            "Stop inter-module ventilation and keep it off until the cool flame is confirmed out."
        )
    elif cool_present and u_crit is not None:
        vent_status = "HOLD"
        vent_text = (
            f"Keep cabin fans off. Restoring airflow above {u_crit:.1f} cm/s while the cool flame is active is predicted "
            "to trigger second-stage hot ignition."
        )
    else:
        vent_status = "REQUIRED"
        vent_text = "Stop ventilation to starve the flame of convective oxidizer supply."
    steps.append(ProtocolStep(
        2, "VENT_CUTOFF", "Command IMV and cabin fan shutdown", vent_status, vent_text,
        {"critical_reignition_airflow_cm_s": None if u_crit is None else round(u_crit, 2),
         "commanded_airflow_cm_s": cfg.airflow_cm_s},
    ))

    diluent_options: list[tuple[DiluentKey, float | None, float | None, float | None]] = []
    for dil in ("N2", "CO2"):
        # Injecting a second diluent changes the mixture; the limit is
        # evaluated for the injected species as the sole diluent, which is
        # conservative for CO2 added to an N2 atmosphere.
        x_lim = limiting_oxygen(cfg.fuel, cfg.pressure_atm, d_ref, dil, cal)  # type: ignore[arg-type]
        if x_lim is None or x_lim >= cfg.x_o2:
            diluent_options.append((dil, x_lim, 0.0 if x_lim is not None else None, cfg.pressure_atm))  # type: ignore[arg-type]
            continue
        target = max(x_lim - 0.005, 0.01)
        p_add = cfg.pressure_atm * (cfg.x_o2 / target - 1.0)
        diluent_options.append((dil, target, p_add, cfg.pressure_atm + p_add))  # type: ignore[arg-type]

    viable = [o for o in diluent_options if o[1] is not None and o[2] is not None]
    if viable:
        best = min(viable, key=lambda o: o[2] or 0.0)
        dil, target, p_add, p_total = best
        over = (p_total or 0.0) > MODULE_MAX_PRESSURE_ATM
        steps.append(ProtocolStep(
            3, "DILUENT_INJECTION",
            f"Inject {dil} to bring O2 to {100.0 * (target or 0.0):.1f} %",
            "REQUIRED" if (p_add or 0.0) > 0.0 else "NOMINAL",
            (
                f"Both flame branches fall below Da = 1 at {100.0 * (target or 0.0):.1f} % O2. Constant-volume injection "
                f"adds {p_add:.2f} atm of {dil}"
                + (f"; total {p_total:.2f} atm exceeds the {MODULE_MAX_PRESSURE_ATM:.2f} atm limit, so vent while injecting." if over else f" for a total of {p_total:.2f} atm.")
            ),
            {
                "diluent": dil, "target_o2_pct": round(100.0 * (target or 0.0), 2),
                "partial_pressure_added_atm": round(p_add or 0.0, 3), "total_pressure_atm": round(p_total or 0.0, 3),
                "n2_target_o2_pct": _pct(diluent_options[0][1]), "co2_target_o2_pct": _pct(diluent_options[1][1]),
                "exceeds_pressure_limit": over,
            },
        ))
    else:
        steps.append(ProtocolStep(
            3, "DILUENT_INJECTION", "Diluent injection alone does not extinguish this fire", "NOT_EFFECTIVE",
            "A flame branch remains viable down to 2 % O2 at this pressure.",
        ))

    p_lim = limiting_pressure(cfg.fuel, cfg.x_o2, d_ref, cfg.diluent, cal)
    if p_lim is not None and p_lim < cfg.pressure_atm:
        p_target = max(p_lim - 0.02, 0.05)
        ppo2 = cfg.x_o2 * p_target
        steps.append(ProtocolStep(
            4, "DEPRESSURIZATION",
            f"Depressurize the affected volume to {p_target:.2f} atm",
            "ADVISORY" if viable else "REQUIRED",
            (
                f"Flame chemistry is not sustained below {p_lim:.2f} atm at {100.0 * cfg.x_o2:.0f} % O2. "
                f"Resulting ppO2 is {ppo2:.3f} atm"
                + ("; below the hypoxia limit, crew must be on breathing apparatus or out of the module." if ppo2 < HYPOXIA_PPO2_ATM else ".")
            ),
            {"target_pressure_atm": round(p_target, 3), "ppo2_atm": round(ppo2, 3), "crew_masks_required": ppo2 < HYPOXIA_PPO2_ATM},
        ))
    else:
        steps.append(ProtocolStep(
            4, "DEPRESSURIZATION", "Depressurization not required", "NOMINAL" if p_lim is not None else "NOT_EFFECTIVE",
            "Atmosphere is already below the sustaining pressure." if p_lim is not None else "Combustion persists down to 0.05 atm in this model.",
        ))

    co_mg = float(summary["co_released_mg"] or 0.0)
    co_ppm_per_m3 = co_mg / CO_MG_M3_PER_PPM
    steps.append(ProtocolStep(
        5, "ATMOSPHERE_RECOVERY",
        "Scrub CO before re-entry; hold until UV and CO/O2 channels return to baseline",
        "REQUIRED" if co_ppm_per_m3 > CO_SMAC_24H_PPM else "ADVISORY",
        (
            f"{co_mg:.1f} mg CO released, equivalent to {co_ppm_per_m3:.1f} ppm in 1 m^3 of stagnant air "
            f"(1-h SMAC {CO_SMAC_1H_PPM:.0f} ppm, 24-h SMAC {CO_SMAC_24H_PPM:.0f} ppm). "
            "Cool-flame burning dominates the CO yield."
        ),
        {"co_released_mg": round(co_mg, 3), "co_ppm_in_1m3": round(co_ppm_per_m3, 2)},
    ))

    if reignited:
        level: Literal["NOMINAL", "WARNING", "CRITICAL"] = "CRITICAL"
        headline = "Ventilation restart re-ignited an undetected cool flame"
    elif hidden:
        level = "CRITICAL"
        headline = "Fire persists as a cool flame invisible to optical sensors"
    else:
        level = "WARNING"
        headline = "Visible hot flame; standard suppression sequence applies"
    return Protocol(level, headline, steps)


def _pct(value: float | None) -> float | None:
    return None if value is None else round(100.0 * value, 2)

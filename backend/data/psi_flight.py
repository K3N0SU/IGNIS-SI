"""Typed access to the NASA PSI experimental tables stored under ``data/psi``.

The CSV files are kept exactly as downloaded by ``data.fetch_psi``. Parsing
is done here, and every cleaning rule is explicit:

* PSI-69 (FLEX) is cp1252-encoded; a missing value is printed as a
  non-numeric placeholder and is read as ``None``.
* The FLEX column headed "Burning rate; mm" is the burning-rate constant in
  mm^2/s (compare NASA/TP-2015-216046), and pressure is given in mmHg.
* A FLEX test is used for model comparison only if fuel, pressure,
  composition and initial diameter are all present and physically valid.
"""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path

PSI_DIR = Path(__file__).resolve().parent / "psi"
MMHG_PER_ATM = 760.0

_FLEX_FUELS = {"heptane": "n-heptane", "methanol": "methanol"}


@dataclass(frozen=True)
class FlexTest:
    test_number: int
    identifier: str
    date: str
    fuel: str  # model fuel key
    pressure_atm: float
    x_o2: float
    x_n2: float
    x_co2: float
    x_he: float
    d0_mm: float | None
    extinction_diameter_mm: float | None
    burning_rate_mm2_s: float | None
    burn_time_s: float | None
    test_end: str

    @property
    def usable(self) -> bool:
        return (
            self.d0_mm is not None
            and 0.5 < self.d0_mm < 8.0
            and 0.05 < self.pressure_atm < 5.0
            and 0.05 < self.x_o2 < 0.9
            and abs(self.x_o2 + self.x_n2 + self.x_co2 + self.x_he - 1.0) < 0.03
        )

    @property
    def diluent_label(self) -> str:
        parts = [name for name, x in (("N2", self.x_n2), ("CO2", self.x_co2), ("He", self.x_he)) if x > 0.005]
        return "+".join(parts) if parts else "N2"


@dataclass(frozen=True)
class CfiTest:
    flex_number: str
    date: str
    pressure_atm: float
    x_o2: float
    x_n2: float
    x_he: float
    fiber_supported: bool | None
    fuel: str


@dataclass(frozen=True)
class SaffireSample:
    mission: str
    sample: str
    material: str
    airflow_cm_s: float | None
    flow_direction: str
    oxygen_pct: str
    burn_time: str
    microgravity_burn_length: str
    normal_gravity_burn_length: str
    microgravity_spread_rate: str
    normal_gravity_spread_rate: str


@dataclass(frozen=True)
class SameAgingRun:
    material: str
    test: str
    description: str
    inlet_velocity_cm_s: float | None
    aging_time_s: float | None


def _read(name: str) -> list[list[str]]:
    raw = (PSI_DIR / name).read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")
    return [row for row in csv.reader(io.StringIO(text)) if any(cell.strip() for cell in row)]


def _number(cell: str) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", cell.replace(",", ""))
    if match is None or not re.fullmatch(r"[\s~<>]*-?\d+(?:\.\d+)?\s*[a-zA-Z/%]*\s*", cell.strip()):
        return None
    return float(match.group())


def _table(pattern: str) -> str:
    matches = sorted(p.name for p in PSI_DIR.glob(pattern))
    if not matches:
        raise FileNotFoundError(f"No PSI table matching {pattern!r}; run `python -m data.fetch_psi`.")
    return matches[0]


@lru_cache(maxsize=1)
def load_flex() -> tuple[FlexTest, ...]:
    rows = _read(_table("PSI-69_*FLEX.csv"))
    tests: list[FlexTest] = []
    for row in rows[1:]:
        row = row + [""] * (15 - len(row))
        fuel = _FLEX_FUELS.get(row[4].strip().lower())
        pressure = _number(row[5])
        composition = [_number(c) for c in row[6:10]]
        if fuel is None or pressure is None or any(v is None for v in composition):
            continue
        tests.append(
            FlexTest(
                test_number=int(float(row[0])),
                identifier=row[1].strip(),
                date=row[2].strip(),
                fuel=fuel,
                pressure_atm=pressure / MMHG_PER_ATM,
                x_o2=composition[0] or 0.0,
                x_n2=composition[1] or 0.0,
                x_co2=composition[2] or 0.0,
                x_he=composition[3] or 0.0,
                d0_mm=_number(row[10]),
                extinction_diameter_mm=_number(row[11]),
                burning_rate_mm2_s=_number(row[12]),
                burn_time_s=_number(row[13]),
                test_end=row[14].strip() or "Unknown",
            )
        )
    return tuple(tests)


@lru_cache(maxsize=1)
def load_cfi() -> tuple[CfiTest, ...]:
    rows = _read(_table("PSI-39_*CFI.csv"))
    tests: list[CfiTest] = []
    for row in rows[1:]:
        row = row + [""] * (10 - len(row))
        pressure, x_o2 = _number(row[4]), _number(row[5])
        if pressure is None or x_o2 is None:
            continue
        fiber = row[8].strip().lower()
        tests.append(
            CfiTest(
                flex_number=row[0].strip(), date=row[1].strip(), pressure_atm=pressure, x_o2=x_o2,
                x_n2=_number(row[6]) or 0.0, x_he=_number(row[7]) or 0.0,
                fiber_supported=None if not fiber else fiber == "yes", fuel=row[9].strip(),
            )
        )
    return tuple(tests)


@lru_cache(maxsize=1)
def load_saffire() -> tuple[SaffireSample, ...]:
    samples: list[SaffireSample] = []
    for mission, pattern in (("Saffire-I", "PSI-98_*.csv"), ("Saffire-II", "PSI-99_*.csv"), ("Saffire-III", "PSI-100_*.csv")):
        rows = _read(_table(pattern))
        header = [h.strip().lower() for h in rows[0]]

        def col(row: list[str], *needles: str) -> str:
            for i, name in enumerate(header):
                if all(n in name for n in needles) and i < len(row):
                    return row[i].strip()
            return ""

        for row in rows[1:]:
            material = col(row, "material")
            if not material or material.lower().startswith("pre-test"):
                continue
            samples.append(
                SaffireSample(
                    mission=mission, sample=row[0].strip(), material=material,
                    airflow_cm_s=_number(col(row, "air flow")),
                    flow_direction=col(row, "direction"), oxygen_pct=col(row, "percent o2"),
                    burn_time=col(row, "burn time"),
                    microgravity_burn_length=col(row, "-g burn length") if mission == "Saffire-II" else "",
                    normal_gravity_burn_length=col(row, "1-g burn length"),
                    microgravity_spread_rate=col(row, "-g spread") if mission == "Saffire-II" else "",
                    normal_gravity_spread_rate=col(row, "1-g spread"),
                )
            )
    return tuple(samples)


@lru_cache(maxsize=1)
def load_same_r() -> tuple[SameAgingRun, ...]:
    rows = _read(_table("PSI-101_*.csv"))
    runs: list[SameAgingRun] = []
    for row in rows[1:]:
        row = row + [""] * (10 - len(row))
        runs.append(
            SameAgingRun(
                material=row[0].strip(), test=row[1].strip(), description=row[2].strip(),
                inlet_velocity_cm_s=_number(row[4]), aging_time_s=_number(row[9]),
            )
        )
    return tuple(runs)


@lru_cache(maxsize=1)
def manifest() -> dict[str, object]:
    return json.loads((PSI_DIR / "manifest.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def investigation(accession: str) -> dict[str, object]:
    return json.loads((PSI_DIR / f"{accession}.json").read_text(encoding="utf-8"))


def table_row_counts() -> dict[str, int]:
    return {p.name: len(_read(p.name)) - 1 for p in sorted(PSI_DIR.glob("*.csv"))}


def flex_as_dicts() -> list[dict[str, object]]:
    return [{**asdict(t), "usable": t.usable, "diluent": t.diluent_label} for t in load_flex()]

"""Summarise, compare and rank the NASA investigations for a fire-safety question.

The challenge this project answers asks for decades of microgravity combustion
results to be summarised, ranked and explained, and compared by fuel, oxygen
level, airflow and sensors. This module produces that comparison from the
records in ``nasa_psi_corpus`` and ranks the investigations by how directly
each one bears on the scenario the user is looking at.

Relevance score, 0 to 100:

  50 %  configuration   how close the experiment type is to the scenario
                        (a single liquid droplet), on a fixed scale
  35 %  coverage        share of the scenario's oxygen, pressure, airflow and
                        droplet-size values that fall inside what was flown
  15 %  evidence        amount of tabulated flight data held, on a log scale

The diagnostics listed per investigation are taken from the investigation
descriptions and the cited papers, not from the experimental tables.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import log10

from data import psi_flight
from data.nasa_psi_corpus import CITATIONS, EXPERIMENTS, Experiment

_CONFIGURATION_WEIGHT: dict[str, float] = {
    "liquid_droplet": 1.0,
    "gaseous": 0.55,
    "solid_fuel": 0.45,
    "smoke_aerosol": 0.35,
}
_CLASS_LABEL: dict[str, str] = {
    "liquid_droplet": "Liquid droplet",
    "gaseous": "Gas flame",
    "solid_fuel": "Solid material",
    "smoke_aerosol": "Smoke and detection",
}
DIAGNOSTICS: dict[str, tuple[str, ...]] = {
    "FLEX": ("backlit droplet camera", "colour flame camera", "UV OH* camera", "radiometers"),
    "FLEX-2": ("backlit droplet camera", "colour flame camera", "UV OH* camera", "radiometers"),
    "CFI": ("backlit droplet camera", "colour flame camera", "intensified UV camera", "radiometers"),
    "CFI-G": ("colour camera", "intensified camera", "thermocouples", "radiometers"),
    "BASS-II": ("video and still cameras", "radiometer", "anemometer", "O2, CO2 and CO gas sensors"),
    "SAFFIRE-I-III": ("video cameras", "thermocouples", "radiometers", "O2 and CO2 sensors"),
    "SAFFIRE-IV-VI": ("video cameras", "thermocouples", "radiometers", "CO, CO2 and O2 sensors"),
    "SAME": ("ionization detector", "light-scattering detector", "particle counters", "thermal precipitator"),
}
_WHY: dict[str, str] = {
    "liquid_droplet": "Same configuration as your scenario: a single burning droplet.",
    "gaseous": "Cool flames in a different configuration; supports the chemistry, not the droplet.",
    "solid_fuel": "Solid cabin materials in airflow; tells you what burns once a fire spreads.",
    "smoke_aerosol": "Smoke and detector response; tells you whether the fire would be noticed.",
}


@dataclass(frozen=True)
class Scenario:
    fuel: str
    d0_mm: float
    x_o2: float
    pressure_atm: float
    airflow_cm_s: float


def _range(exp: Experiment, key: str) -> dict[str, object] | None:
    r = exp.envelope.get(key)
    if r is None:
        return None
    return {"low": r.low, "high": r.high, "unit": r.unit, "source": r.confidence}


def _coverage(exp: Experiment, scenario: Scenario) -> tuple[float, list[str]]:
    values = {
        "d0_mm": scenario.d0_mm, "x_o2": scenario.x_o2,
        "pressure_atm": scenario.pressure_atm, "airflow_cm_s": scenario.airflow_cm_s,
    }
    labels = {"d0_mm": "droplet size", "x_o2": "oxygen", "pressure_atm": "pressure", "airflow_cm_s": "airflow"}
    checked = [k for k in values if k in exp.envelope]
    if not checked:
        return 0.0, []
    inside = [k for k in checked if exp.envelope[k].low - 1e-9 <= values[k] <= exp.envelope[k].high + 1e-9]
    outside = [labels[k] for k in checked if k not in inside]
    return len(inside) / len(checked), outside


def compare(scenario: Scenario) -> list[dict[str, object]]:
    """Every investigation with its comparison attributes, ranked for the scenario."""
    manifest = psi_flight.manifest()["investigations"]
    rows: list[dict[str, object]] = []
    for exp in EXPERIMENTS.values():
        coverage, outside = _coverage(exp, scenario)
        configuration = _CONFIGURATION_WEIGHT[exp.experiment_class]
        evidence = min(log10(1 + exp.flight_tests) / log10(1 + 350), 1.0)
        fuel_flown = exp.experiment_class == "liquid_droplet" and scenario.fuel in exp.model_fuels
        score = 100.0 * (0.50 * configuration * (1.0 if fuel_flown or exp.experiment_class != "liquid_droplet" else 0.8)
                         + 0.35 * coverage + 0.15 * evidence)

        why = _WHY[exp.experiment_class]
        if exp.experiment_class == "liquid_droplet":
            why += " This fuel was flown." if fuel_flown else " A different fuel was flown."
        if outside:
            verb = "are" if len(outside) > 1 else "is"
            why += f" Your {' and '.join(outside)} {verb} outside what it tested."
        elif coverage == 1.0:
            why += " Your conditions are inside what it tested."

        dois = [str(manifest[a]["doi"]) for a in exp.accessions if a in manifest]  # type: ignore[index]
        rows.append({
            "key": exp.key,
            "name": exp.name,
            "full_name": exp.full_name,
            "type": _CLASS_LABEL[exp.experiment_class],
            "period": exp.period,
            "platform": exp.platform,
            "fuels": list(exp.fuels)[:5],
            "oxygen": _range(exp, "x_o2"),
            "pressure": _range(exp, "pressure_atm"),
            "airflow": _range(exp, "airflow_cm_s"),
            "diagnostics": list(DIAGNOSTICS.get(exp.key, ())),
            "records": exp.flight_tests,
            "accessions": list(exp.accessions),
            "dataset_dois": dois,
            "summary": exp.findings[0],
            "findings": list(exp.findings),
            "papers": [{"title": CITATIONS[c].title, "doi": CITATIONS[c].doi, "url": CITATIONS[c].url} for c in exp.citations],
            "relevance": round(score, 1),
            "coverage": round(coverage, 2),
            "why": why,
        })
    rows.sort(key=lambda r: float(r["relevance"]), reverse=True)  # type: ignore[arg-type]
    for i, row in enumerate(rows, start=1):
        row["rank"] = i
    return rows

"""Epistemic-uncertainty assessment of a queried chamber condition.

Two independent signals are reported.

Envelope position. The query is compared with the tested parameter ranges of
the ISS droplet campaigns (FLEX, FLEX-2, CFI). It is

  VERIFIED         inside every tested range of one campaign that flew the
                   same fuel and diluent;
  INTERPOLATED     covered dimension-by-dimension by the campaigns taken
                   together, but not jointly by any single one;
  BEYOND_FRONTIER  outside the tested range in at least one dimension.

Model disagreement. The closure constants of the reduced-order model are
not known exactly. An ensemble of solver runs with those constants perturbed
within their plausible spread is evaluated at the query; the entropy of the
predicted outcome class measures how strongly the answer depends on the
calibration. A high value inside the envelope marks a regime boundary; a
high value beyond the frontier marks a prediction that should not be trusted
without a new experiment.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import log, sqrt
from typing import Literal

import numpy as np

from data.nasa_psi_corpus import DROPLET_CAMPAIGNS, ENVELOPE_DIMENSIONS, EXPERIMENTS
from physics.properties import DEFAULT_CALIBRATION, ModelCalibration
from physics.solver import SimulationConfig, simulate

Verdict = Literal["VERIFIED", "INTERPOLATED", "BEYOND_FRONTIER"]

_PERTURBED_CONSTANTS: tuple[str, ...] = (
    "accumulation_factor", "standoff_peclet_coeff", "kappa_planck", "tau_chem_hot",
    "t_cool_gain", "tau_chem_cool", "t_reignition", "cool_standoff",
)
_RELATIVE_SIGMA: dict[str, float] = {
    "accumulation_factor": 0.08, "standoff_peclet_coeff": 0.20, "kappa_planck": 0.12, "tau_chem_hot": 0.30,
    "t_cool_gain": 0.15, "tau_chem_cool": 0.20, "t_reignition": 0.02, "cool_standoff": 0.08,
}
_DIMENSION_LABELS: dict[str, str] = {
    "d0_mm": "Droplet diameter", "x_o2": "Oxygen fraction",
    "pressure_atm": "Pressure", "airflow_cm_s": "Airflow",
}
OUTCOMES: tuple[str, ...] = ("NO_IGNITION", "HOT_BURNOUT", "COOL_FLAME", "REIGNITION", "BLOWOFF")


@dataclass(frozen=True)
class DimensionCheck:
    dimension: str
    label: str
    value: float
    tested_low: float
    tested_high: float
    unit: str
    inside: bool
    exceedance: float  # distance outside the union range, in units of that range


@dataclass(frozen=True)
class CampaignCheck:
    campaign: str
    fuel_tested: bool
    diluent_tested: bool
    inside_all: bool
    distance: float


@dataclass(frozen=True)
class Assessment:
    verdict: Verdict
    summary: str
    frontier_distance: float
    dimensions: list[DimensionCheck]
    campaigns: list[CampaignCheck]
    nearest_campaign: str
    model_disagreement: float | None
    outcome_distribution: dict[str, float] | None
    predicted_outcome: str | None
    ensemble_size: int


def _exceedance(value: float, low: float, high: float, scale: float) -> float:
    if value < low:
        return (low - value) / scale
    if value > high:
        return (value - high) / scale
    return 0.0


def envelope_check(cfg: SimulationConfig) -> tuple[Verdict, float, list[DimensionCheck], list[CampaignCheck]]:
    values = {"d0_mm": cfg.d0_mm, "x_o2": cfg.x_o2, "pressure_atm": cfg.pressure_atm, "airflow_cm_s": cfg.airflow_cm_s}
    campaigns = [EXPERIMENTS[k] for k in DROPLET_CAMPAIGNS]

    dims: list[DimensionCheck] = []
    union_scale: dict[str, float] = {}
    for dim in ENVELOPE_DIMENSIONS:
        low = min(c.envelope[dim].low for c in campaigns)
        high = max(c.envelope[dim].high for c in campaigns)
        scale = max(high - low, 1e-9)
        union_scale[dim] = scale
        exc = _exceedance(values[dim], low, high, scale)
        dims.append(DimensionCheck(dim, _DIMENSION_LABELS[dim], values[dim], low, high, campaigns[0].envelope[dim].unit, exc == 0.0, round(exc, 4)))

    checks: list[CampaignCheck] = []
    for c in campaigns:
        dist2 = sum(
            _exceedance(values[d], c.envelope[d].low, c.envelope[d].high, union_scale[d]) ** 2 for d in ENVELOPE_DIMENSIONS
        )
        fuel_ok = cfg.fuel in c.model_fuels
        diluent_ok = cfg.diluent in c.diluents
        checks.append(CampaignCheck(c.key, fuel_ok, diluent_ok, dist2 == 0.0 and fuel_ok and diluent_ok, round(sqrt(dist2), 4)))

    frontier = sqrt(sum(d.exceedance**2 for d in dims))
    if any(c.inside_all for c in checks):
        verdict: Verdict = "VERIFIED"
    elif frontier == 0.0:
        verdict = "INTERPOLATED"
    else:
        verdict = "BEYOND_FRONTIER"
    return verdict, round(frontier, 4), dims, checks


def classify_outcome(summary: dict[str, float | str | bool | None]) -> str:
    if float(summary["hot_flame_duration_s"] or 0.0) == 0.0:
        return "NO_IGNITION"
    if int(summary["reignition_count"] or 0) > 0:
        return "REIGNITION"
    if bool(summary["cool_flame_present"]):
        return "COOL_FLAME"
    if summary["extinction_mode"] == "CONVECTIVE_BLOWOFF" and float(summary["fuel_consumed_fraction"] or 0.0) < 0.9:
        return "BLOWOFF"
    return "HOT_BURNOUT"


def calibration_ensemble(size: int, seed: int = 2024) -> list[ModelCalibration]:
    rng = np.random.default_rng(seed)
    members = [DEFAULT_CALIBRATION]
    for _ in range(size - 1):
        scale = {k: float(np.exp(_RELATIVE_SIGMA[k] * rng.standard_normal())) for k in _PERTURBED_CONSTANTS}
        members.append(DEFAULT_CALIBRATION.perturbed(scale))
    return members


def model_disagreement(cfg: SimulationConfig, size: int = 12) -> tuple[float, dict[str, float], str]:
    """Normalised outcome entropy across the calibration ensemble (0 = unanimous)."""
    fast = SimulationConfig(**{**asdict(cfg), "dt_s": 0.2, "t_max_s": min(cfg.t_max_s, 60.0)})
    outcomes = [classify_outcome(simulate(fast, cal).summary) for cal in calibration_ensemble(size)]
    dist = {o: outcomes.count(o) / len(outcomes) for o in OUTCOMES}
    entropy = -sum(p * log(p) for p in dist.values() if p > 0.0) / log(len(OUTCOMES))
    return round(entropy, 4), dist, outcomes[0]


def assess(cfg: SimulationConfig, ensemble_size: int = 12) -> Assessment:
    verdict, frontier, dims, checks = envelope_check(cfg)
    nearest = min(checks, key=lambda c: (c.distance, not c.fuel_tested))
    disagreement: float | None = None
    distribution: dict[str, float] | None = None
    predicted: str | None = None
    if ensemble_size > 0:
        disagreement, distribution, predicted = model_disagreement(cfg, ensemble_size)

    outside = [d for d in dims if not d.inside]
    if verdict == "VERIFIED":
        summary = f"Inside the tested envelope of {nearest.campaign}. Flight data exist for this fuel and atmosphere."
    elif verdict == "INTERPOLATED":
        summary = (
            "Each parameter was tested on orbit, but not in this combination or not with this fuel. "
            "Prediction interpolates between campaigns."
        )
    else:
        names = ", ".join(
            f"{d.label.lower()} {d.value:g} {d.unit} (tested {d.tested_low:g}-{d.tested_high:g})" for d in outside
        )
        summary = f"Beyond the tested frontier: {names}. No orbital droplet data constrain this prediction."
    return Assessment(
        verdict, summary, frontier, dims, checks, nearest.campaign,
        disagreement, distribution, predicted, ensemble_size,
    )


def frontier_map(
    fuel: str, d0_mm: float, pressure_atm: float, diluent: str,
    o2_values: list[float], airflow_values: list[float],
) -> list[list[str]]:
    """Envelope verdict over an O2 x airflow grid (rows: airflow, columns: O2)."""
    grid: list[list[str]] = []
    for u in airflow_values:
        row: list[str] = []
        for x in o2_values:
            cfg = SimulationConfig(fuel=fuel, d0_mm=d0_mm, x_o2=x, pressure_atm=pressure_atm, airflow_cm_s=u, diluent=diluent)  # type: ignore[arg-type]
            row.append(envelope_check(cfg)[0])
        grid.append(row)
    return grid

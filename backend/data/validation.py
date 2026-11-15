"""Compare the droplet model with every usable FLEX flight test (NASA PSI-69).

For each test the solver is run at the recorded fuel, pressure, composition
and initial diameter, and three reported quantities are compared:

  burning-rate constant K   reported average over the visible-flame burn
  visible-flame extinction  diameter at which the hot flame went out,
                            normalised by the initial diameter
  outcome                   whether the visible flame was lost with a large
                            droplet remaining (radiative extinction) or the
                            droplet burned nearly to completion

Usage:  python -m data.validation
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from data.psi_flight import FlexTest, load_flex
from physics.properties import DEFAULT_CALIBRATION, ModelCalibration
from physics.solver import SimulationConfig, simulate

OUTPUT_PATH = Path(__file__).resolve().parent / "generated" / "flex_validation.json"
# A visible-flame extinction diameter above this fraction of D0 means the hot
# flame was lost while most of the fuel remained.
EARLY_EXTINCTION_RATIO = 0.5
# Tolerance, as a fraction of D0, for counting an extinction diameter as reproduced.
EXTINCTION_TOLERANCE = 0.2


@dataclass(frozen=True)
class Comparison:
    test_number: int
    identifier: str
    date: str
    fuel: str
    diluent: str
    pressure_atm: float
    x_o2: float
    x_co2: float
    x_he: float
    d0_mm: float
    test_end: str
    k_flight: float | None
    k_model: float | None
    ext_ratio_flight: float | None
    ext_ratio_model: float | None
    burn_time_flight: float | None
    hot_time_model: float
    early_extinction_flight: bool | None
    early_extinction_model: bool
    model_ignited: bool
    model_cool_flame: bool


def config_for(test: FlexTest, dt_s: float = 0.1, t_max_s: float = 60.0) -> SimulationConfig:
    if test.d0_mm is None:
        raise ValueError("test has no initial diameter")
    return SimulationConfig(
        fuel=test.fuel,  # type: ignore[arg-type]
        d0_mm=test.d0_mm, x_o2=test.x_o2, pressure_atm=test.pressure_atm,
        x_co2=test.x_co2, x_he=test.x_he, t_max_s=t_max_s, dt_s=dt_s,
    )


def compare(test: FlexTest, cal: ModelCalibration = DEFAULT_CALIBRATION) -> Comparison:
    cfg = config_for(test)
    result = simulate(cfg, cal)
    summary = result.summary
    hot_time = float(summary["hot_flame_duration_s"] or 0.0)
    ignited = hot_time > 0.0

    extinctions = [e for e in result.events if e.kind.startswith("HOT_FLAME_EXTINCTION")]
    if not ignited:
        ext_model = 1.0
    elif extinctions:
        idx = int(np.searchsorted(result.t, extinctions[0].t))
        ext_model = float(result.series["d_mm"][min(idx, len(result.t) - 1)]) / cfg.d0_mm
    else:
        ext_model = 0.0

    ext_flight = None
    if test.extinction_diameter_mm is not None and test.d0_mm:
        ext_flight = test.extinction_diameter_mm / test.d0_mm

    return Comparison(
        test_number=test.test_number, identifier=test.identifier, date=test.date, fuel=test.fuel,
        diluent=test.diluent_label, pressure_atm=round(test.pressure_atm, 4), x_o2=test.x_o2,
        x_co2=test.x_co2, x_he=test.x_he, d0_mm=float(test.d0_mm or 0.0), test_end=test.test_end,
        k_flight=test.burning_rate_mm2_s,
        k_model=float(summary["mean_hot_burning_rate_mm2_s"]) if summary["mean_hot_burning_rate_mm2_s"] is not None else None,
        ext_ratio_flight=None if ext_flight is None else round(ext_flight, 4),
        ext_ratio_model=round(ext_model, 4),
        burn_time_flight=test.burn_time_s, hot_time_model=hot_time,
        early_extinction_flight=None if ext_flight is None else ext_flight > EARLY_EXTINCTION_RATIO,
        early_extinction_model=ext_model > EARLY_EXTINCTION_RATIO,
        model_ignited=ignited, model_cool_flame=bool(summary["cool_flame_present"]),
    )


def metrics(rows: list[Comparison]) -> dict[str, object]:
    def stats(pairs: list[tuple[float, float]]) -> dict[str, float | int]:
        if not pairs:
            return {"n": 0}
        flight = np.array([p[0] for p in pairs])
        model = np.array([p[1] for p in pairs])
        err = model - flight
        ss_res = float(np.sum(err**2))
        ss_tot = float(np.sum((flight - flight.mean()) ** 2)) or 1.0
        return {
            "n": len(pairs),
            "mae": round(float(np.mean(np.abs(err))), 4),
            "bias": round(float(np.mean(err)), 4),
            "rmse": round(float(np.sqrt(np.mean(err**2))), 4),
            "mape_pct": round(float(np.mean(np.abs(err) / np.maximum(np.abs(flight), 1e-6))) * 100.0, 2),
            "r2": round(1.0 - ss_res / ss_tot, 4),
            "pearson_r": round(float(np.corrcoef(flight, model)[0, 1]), 4) if len(pairs) > 2 else 0.0,
        }

    out: dict[str, object] = {"tests_compared": len(rows)}
    for fuel in ("all", "n-heptane", "methanol"):
        sel = [r for r in rows if fuel == "all" or r.fuel == fuel]
        k_pairs = [(r.k_flight, r.k_model) for r in sel if r.k_flight and r.k_model]
        # A test the model will not ignite counts as an extinction at the full initial diameter.
        e_pairs = [(r.ext_ratio_flight, r.ext_ratio_model) for r in sel if r.ext_ratio_flight is not None]
        within = sum(abs(m - f) <= EXTINCTION_TOLERANCE for f, m in e_pairs)  # type: ignore[operator]
        labelled = [r for r in sel if r.early_extinction_flight is not None]
        agree = sum(r.early_extinction_flight == r.early_extinction_model for r in labelled)
        out[fuel] = {
            "tests": len(sel),
            "burning_rate_mm2_s": stats(k_pairs),  # type: ignore[arg-type]
            "extinction_diameter_ratio": stats(e_pairs),  # type: ignore[arg-type]
            "outcome_agreement": round(agree / len(labelled), 4) if labelled else None,
            "extinction_within_tolerance": round(within / len(e_pairs), 4) if e_pairs else None,
            "outcome_n": len(labelled),
            "model_failed_to_ignite": sum(not r.model_ignited for r in sel),
        }
    return out


def run(cal: ModelCalibration = DEFAULT_CALIBRATION, save: bool = True) -> dict[str, object]:
    rows = [compare(t, cal) for t in load_flex() if t.usable]
    report: dict[str, object] = {
        "dataset": "NASA PSI-69, Flame Extinguishment Experiment (FLEX), experimental table",
        "dataset_doi": "10.60555/mbq8-0451",
        "metrics": metrics(rows),
        "tests": [asdict(r) for r in rows],
    }
    if save:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_PATH.write_text(json.dumps(report, indent=1), encoding="utf-8")
    return report


def main() -> None:
    report = run()
    print(json.dumps(report["metrics"], indent=1))


if __name__ == "__main__":
    main()

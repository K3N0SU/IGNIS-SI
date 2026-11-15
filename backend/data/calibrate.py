"""Fit the model's closure constants to the FLEX flight table (NASA PSI-69).

The usable FLEX tests are split by test number into a training set and a
held-out set (every fourth test). A Nelder-Mead search over the logarithms
of the selected constants minimises, on the training set only,

    sum_i [ ((K_model - K_flight) / s_K)^2
          + ((x_model - x_flight) / s_x)^2
          + P * (model failed to ignite a test that burned) ]

where x is the visible-flame extinction diameter divided by D0. The fitted
constants and the metrics on both sets are written to
``data/calibration_fit.json``, which ``physics.properties`` loads at import.

Usage:  python -m data.calibrate [--iterations 220] [--workers 8]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

from data.psi_flight import FlexTest, load_flex
from data.validation import Comparison, compare, metrics
from physics.properties import BASELINE_CALIBRATION, DEFAULT_CALIBRATION, ModelCalibration

FIT_PATH = Path(__file__).resolve().parent / "calibration_fit.json"
HOLDOUT_EVERY = 4

FITTED: tuple[str, ...] = (
    "kappa_planck", "tau_chem_hot", "accumulation_factor", "conductivity_scale",
    "methanol_chem_factor", "methanol_kappa_factor", "co2_kappa_factor", "water_absorption", "water_exponent",
)
BOUNDS: dict[str, tuple[float, float]] = {
    "kappa_planck": (0.8, 9.0), "tau_chem_hot": (2e-10, 5e-8), "accumulation_factor": (0.12, 0.5),
    "conductivity_scale": (0.8, 1.35), "methanol_chem_factor": (0.005, 3.0), "methanol_kappa_factor": (0.05, 1.5), "co2_kappa_factor": (0.6, 4.0),
    "water_absorption": (0.02, 0.7), "water_exponent": (0.2, 10.0),
}
SIGMA_K = 0.08  # mm^2/s
SIGMA_X = 0.15  # diameter ratio
IGNITION_PENALTY = 2.0
BATCH_TIMEOUT_S = 120.0
CHECKPOINT_PATH = Path(__file__).resolve().parent / "generated" / "calibration_checkpoint.json"


def split(tests: tuple[FlexTest, ...]) -> tuple[list[FlexTest], list[FlexTest]]:
    usable = [t for t in tests if t.usable]
    train = [t for i, t in enumerate(usable) if i % HOLDOUT_EVERY != HOLDOUT_EVERY - 1]
    holdout = [t for i, t in enumerate(usable) if i % HOLDOUT_EVERY == HOLDOUT_EVERY - 1]
    return train, holdout


def _compare(args: tuple[FlexTest, ModelCalibration]) -> Comparison:
    return compare(*args)


class Evaluator:
    """Runs the model over a set of tests in worker processes.

    Worker processes can die under load on some platforms; the pool is then
    rebuilt and the batch repeated, falling back to the calling process if
    it keeps failing. Results do not depend on which path was taken.
    """

    def __init__(self, workers: int) -> None:
        self.workers = workers
        self.pool: ProcessPoolExecutor | None = ProcessPoolExecutor(max_workers=workers) if workers > 1 else None

    def __call__(self, tests: list[FlexTest], cal: ModelCalibration) -> list[Comparison]:
        jobs = [(t, cal) for t in tests]
        for _ in range(4):
            if self.pool is None:
                break
            try:
                # The timeout turns a silently dead worker into a retry instead of a hang.
                return list(self.pool.map(_compare, jobs, chunksize=4, timeout=BATCH_TIMEOUT_S))
            except Exception:
                self.pool.shutdown(wait=False, cancel_futures=True)
                self.pool = ProcessPoolExecutor(max_workers=self.workers)
        return [_compare(j) for j in jobs]

    def close(self) -> None:
        if self.pool is not None:
            self.pool.shutdown(wait=False, cancel_futures=True)


def loss(rows: list[Comparison]) -> float:
    total = 0.0
    for r in rows:
        burned = (r.k_flight or 0.0) > 0.0
        if not r.model_ignited:
            # A test the model will not ignite is scored as an immediate extinction.
            total += IGNITION_PENALTY if burned else 0.0
            if r.ext_ratio_flight is not None:
                total += ((1.0 - r.ext_ratio_flight) / SIGMA_X) ** 2
            continue
        if r.k_flight and r.k_model:
            total += ((r.k_model - r.k_flight) / SIGMA_K) ** 2
        if r.ext_ratio_flight is not None and r.ext_ratio_model is not None:
            total += ((r.ext_ratio_model - r.ext_ratio_flight) / SIGMA_X) ** 2
    return total / max(len(rows), 1)


def to_calibration(theta: np.ndarray) -> ModelCalibration:
    values = asdict(BASELINE_CALIBRATION)
    for name, log_value in zip(FITTED, theta):
        lo, hi = BOUNDS[name]
        values[name] = min(max(math.exp(float(log_value)), lo), hi)
    return ModelCalibration(**values)


def fit(iterations: int, workers: int) -> dict[str, object]:
    # One BLAS thread per worker: the default thread pool per process exhausts memory.
    for name in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
        os.environ.setdefault(name, "1")
    train, holdout = split(load_flex())
    started = time.time()
    evaluate = Evaluator(workers)
    history: list[float] = []

    def objective(theta: np.ndarray) -> float:
        value = loss(evaluate(train, to_calibration(theta)))
        if not history or value < min(history):
            CHECKPOINT_PATH.parent.mkdir(parents=True, exist_ok=True)
            CHECKPOINT_PATH.write_text(json.dumps({"theta": [float(v) for v in theta], "loss": value}), encoding="utf-8")
        history.append(value)
        if len(history) % 20 == 0:
            print(f"  eval {len(history):4d}  loss {min(history):.4f}  ({time.time() - started:.0f} s)", flush=True)
        return value

    # Continue from the stored fit when there is one. On a first run methanol is
    # given a faster, less radiative flame than n-heptane so the search begins
    # on the burning side of its flammability limit.
    start = DEFAULT_CALIBRATION if FIT_PATH.exists() else replace(
        BASELINE_CALIBRATION, methanol_chem_factor=0.3, methanol_kappa_factor=0.5, water_absorption=0.25, water_exponent=2.0
    )
    x0 = np.array([math.log(getattr(start, name)) for name in FITTED])
    initial_loss = loss(evaluate(train, BASELINE_CALIBRATION))
    if iterations > 0:
        result = minimize(
            objective, x0, method="Nelder-Mead",
            options={"maxfev": iterations, "xatol": 5e-3, "fatol": 1e-4, "initial_simplex": _simplex(x0)},
        )
        best_theta, best_loss = result.x, float(result.fun)
    else:
        # Finalise from the best point saved by an earlier, interrupted search.
        saved = json.loads(CHECKPOINT_PATH.read_text(encoding="utf-8"))
        best_theta, best_loss = np.array(saved["theta"]), float(saved["loss"])
    evaluate.close()
    fitted = to_calibration(best_theta)

    # Reported metrics are computed in this process, independent of the pool.
    serial = Evaluator(1)
    report = {
        "dataset": "NASA PSI-69 FLEX experimental table",
        "dataset_doi": "10.60555/mbq8-0451",
        "fitted_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "method": "Nelder-Mead on log-parameters, training set only",
        "evaluations": len(history),
        "train_tests": len(train),
        "holdout_tests": len(holdout),
        "loss_initial": round(initial_loss, 4),
        "loss_final": round(best_loss, 4),
        "parameters": {name: getattr(fitted, name) for name in FITTED},
        "baseline_parameters": {name: getattr(BASELINE_CALIBRATION, name) for name in FITTED},
        "metrics": {
            "baseline_train": metrics(serial(train, BASELINE_CALIBRATION)),
            "baseline_holdout": metrics(serial(holdout, BASELINE_CALIBRATION)),
            "fitted_train": metrics(serial(train, fitted)),
            "fitted_holdout": metrics(serial(holdout, fitted)),
        },
    }
    FIT_PATH.write_text(json.dumps(report, indent=1), encoding="utf-8")
    return report


def _simplex(x0: np.ndarray) -> np.ndarray:
    simplex = np.tile(x0, (len(x0) + 1, 1))
    for i in range(len(x0)):
        simplex[i + 1, i] += 0.25
    return simplex


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--iterations", type=int, default=220, help="0 finalises from the saved checkpoint")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    report = fit(args.iterations, args.workers)
    print(json.dumps({k: report[k] for k in ("loss_initial", "loss_final", "parameters")}, indent=1))
    for name in ("baseline_holdout", "fitted_holdout"):
        m = report["metrics"][name]["all"]  # type: ignore[index]
        print(name, json.dumps({k: m[k] for k in ("burning_rate_mm2_s", "extinction_diameter_ratio", "outcome_agreement", "model_failed_to_ignite")}))


if __name__ == "__main__":
    main()

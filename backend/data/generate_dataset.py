"""Build the labelled multi-sensor training set from solver sweeps.

Scenarios are drawn by Latin hypercube sampling over the chamber parameter
space, each is integrated with the droplet solver, and the three sensor
channels the classifier is allowed to see (radiometer, UV chemiluminescence,
CO/O2 ratio) are corrupted with instrument noise. The optical-camera channel
is deliberately excluded from the feature set.

Usage:  python -m data.generate_dataset [--scenarios 360] [--seed 7]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.stats import qmc

from data.nasa_psi_corpus import nearest_campaign
from ml.features import FEATURE_NAMES, LABELS, SensorNoise, build_features, label_index
from physics.solver import SimulationConfig, simulate

OUTPUT_DIR = Path(__file__).resolve().parent / "generated"
DATASET_PATH = OUTPUT_DIR / "regime_dataset.npz"
MANIFEST_PATH = OUTPUT_DIR / "regime_dataset_manifest.json"

_FUELS = ("n-heptane", "n-decane", "n-dodecane", "methanol")
_FUEL_WEIGHTS = (0.5, 0.2, 0.2, 0.1)


def sample_scenarios(n: int, seed: int) -> list[SimulationConfig]:
    rng = np.random.default_rng(seed)
    unit = qmc.LatinHypercube(d=5, seed=seed).random(n)
    configs: list[SimulationConfig] = []
    for row in unit:
        d0 = 1.5 + 3.5 * row[0]
        x_o2 = 0.14 + 0.20 * row[1]
        pressure = 0.5 + 0.9 * row[2]
        # Half of the scenarios are quiescent or near-quiescent so the
        # cool-flame and re-ignition-risk classes are well populated.
        airflow = 0.0 if row[3] < 0.25 else 14.0 * (row[3] - 0.25) / 0.75
        restore = row[4] < 0.6
        fuel = str(rng.choice(_FUELS, p=_FUEL_WEIGHTS))
        configs.append(
            SimulationConfig(
                fuel=fuel,  # type: ignore[arg-type]
                d0_mm=round(float(d0), 3),
                x_o2=round(float(x_o2), 4),
                pressure_atm=round(float(pressure), 3),
                airflow_cm_s=round(float(airflow), 2),
                flow_mode="RESTORE_AFTER_EXTINCTION" if restore else "CONTINUOUS",
                restore_delay_s=round(float(rng.uniform(1.5, 8.0)), 2),
                t_max_s=60.0,
                dt_s=0.1,
            )
        )
    return configs


def generate(n_scenarios: int = 360, seed: int = 7) -> dict[str, object]:
    rng = np.random.default_rng(seed + 1)
    noise = SensorNoise()
    features: list[np.ndarray] = []
    labels: list[np.ndarray] = []
    groups: list[np.ndarray] = []
    campaigns: list[str] = []

    for gid, cfg in enumerate(sample_scenarios(n_scenarios, seed)):
        result = simulate(cfg)
        x = build_features(
            result.t,
            noise.apply(result.series["radiometer_w_m2"], "radiometer", rng),
            noise.apply(result.series["uv_intensity"], "uv", rng),
            noise.apply(result.series["co_o2_ratio"], "co_o2", rng),
        )
        y = np.array([label_index(r) for r in result.regime], dtype=np.int64)
        features.append(x)
        labels.append(y)
        groups.append(np.full(len(y), gid, dtype=np.int64))
        campaigns.append(nearest_campaign(cfg.fuel, cfg.airflow_cm_s).key)

    x_all = np.vstack(features)
    y_all = np.concatenate(labels)
    g_all = np.concatenate(groups)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(DATASET_PATH, x=x_all, y=y_all, groups=g_all)
    counts = {LABELS[i]: int((y_all == i).sum()) for i in range(len(LABELS))}
    manifest: dict[str, object] = {
        "source": "model",
        "generator": "physics.solver.simulate",
        "scenarios": n_scenarios,
        "seed": seed,
        "rows": int(len(y_all)),
        "features": list(FEATURE_NAMES),
        "labels": list(LABELS),
        "class_counts": counts,
        "reference_campaign_counts": {k: campaigns.count(k) for k in sorted(set(campaigns))},
        "sensor_noise": noise.as_dict(),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--scenarios", type=int, default=360)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    manifest = generate(args.scenarios, args.seed)
    print(json.dumps({k: manifest[k] for k in ("rows", "class_counts")}, indent=2))


if __name__ == "__main__":
    main()

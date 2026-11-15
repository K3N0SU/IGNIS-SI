"""Generate the dataset if needed and train the regime classifier.

Usage:  python -m ml.train [--scenarios 360] [--regenerate]
"""

from __future__ import annotations

import argparse
import json

import numpy as np

from data.generate_dataset import DATASET_PATH, generate
from ml.regime_classifier import MODEL_PATH, RegimeClassifier, train


def ensure_trained(scenarios: int = 360, regenerate: bool = False) -> RegimeClassifier:
    """Return a loaded classifier, building dataset and model on first use."""
    if regenerate or not DATASET_PATH.exists():
        generate(scenarios)
    if regenerate or not MODEL_PATH.exists():
        data = np.load(DATASET_PATH)
        train(data["x"], data["y"], data["groups"])
    try:
        return RegimeClassifier.load()
    except RuntimeError:
        generate(scenarios)
        data = np.load(DATASET_PATH)
        train(data["x"], data["y"], data["groups"])
        return RegimeClassifier.load()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--scenarios", type=int, default=360)
    parser.add_argument("--regenerate", action="store_true")
    args = parser.parse_args()
    if args.regenerate or not DATASET_PATH.exists():
        manifest = generate(args.scenarios)
        print(json.dumps({"rows": manifest["rows"], "class_counts": manifest["class_counts"]}, indent=2))
    data = np.load(DATASET_PATH)
    metrics = train(data["x"], data["y"], data["groups"])
    print(json.dumps({k: metrics[k] for k in ("accuracy", "macro_f1", "per_class", "test_scenarios")}, indent=2))


if __name__ == "__main__":
    main()

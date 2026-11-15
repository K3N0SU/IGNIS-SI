"""Combustion-regime classifier operating on non-optical sensor channels.

Inputs are the broadband radiometer flux, the intensified-UV
chemiluminescence signal and the CO/O2 ratio from the gas analyser. The
visible-light camera is not an input: the purpose of the model is to
identify a cool flame when the camera shows nothing.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import GroupShuffleSplit

from .features import FEATURE_NAMES, LABELS, SensorNoise, build_features

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
MODEL_PATH = ARTIFACT_DIR / "regime_classifier.joblib"
METRICS_PATH = ARTIFACT_DIR / "regime_classifier_metrics.json"


@dataclass
class ClassifierOutput:
    labels: list[str]
    confidence: np.ndarray
    probabilities: np.ndarray  # shape (n_samples, n_labels)


def train(x: np.ndarray, y: np.ndarray, groups: np.ndarray, seed: int = 11) -> dict[str, object]:
    """Fit on 80 % of the scenarios and score on the held-out 20 %.

    The split is by scenario, not by row: adjacent samples of one burn are
    strongly correlated and a row-wise split would leak.
    """
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed)
    train_idx, test_idx = next(splitter.split(x, y, groups))
    model = HistGradientBoostingClassifier(
        max_iter=300, learning_rate=0.08, max_leaf_nodes=31, l2_regularization=0.1,
        class_weight="balanced", early_stopping=True, validation_fraction=0.12, random_state=seed,
    )
    model.fit(x[train_idx], y[train_idx])

    pred = model.predict(x[test_idx])
    present = sorted(set(y[test_idx].tolist()) | set(pred.tolist()))
    report = classification_report(
        y[test_idx], pred, labels=present, target_names=[LABELS[i] for i in present],
        output_dict=True, zero_division=0,
    )
    metrics: dict[str, object] = {
        "accuracy": float(accuracy_score(y[test_idx], pred)),
        "macro_f1": float(report["macro avg"]["f1-score"]),
        "per_class": {LABELS[i]: {k: float(v) for k, v in report[LABELS[i]].items()} for i in present},
        "confusion_matrix": confusion_matrix(y[test_idx], pred, labels=list(range(len(LABELS)))).tolist(),
        "labels": list(LABELS),
        "features": list(FEATURE_NAMES),
        "train_rows": int(len(train_idx)),
        "test_rows": int(len(test_idx)),
        "test_scenarios": int(len(set(groups[test_idx].tolist()))),
        "training_data": "model-generated sensor traces with instrument noise; not flight data",
    }
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "labels": LABELS, "features": FEATURE_NAMES}, MODEL_PATH)
    METRICS_PATH.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    return metrics


class RegimeClassifier:
    def __init__(self, model: HistGradientBoostingClassifier) -> None:
        self._model = model
        self._classes = [int(c) for c in model.classes_]

    @classmethod
    def load(cls, path: Path = MODEL_PATH) -> "RegimeClassifier":
        bundle = joblib.load(path)
        if tuple(bundle["features"]) != FEATURE_NAMES or tuple(bundle["labels"]) != LABELS:
            raise RuntimeError("Classifier artifact does not match the current feature schema; retrain with `python -m ml.train`.")
        return cls(bundle["model"])

    def predict_features(self, features: np.ndarray) -> ClassifierOutput:
        raw = self._model.predict_proba(features)
        proba = np.zeros((len(features), len(LABELS)))
        proba[:, self._classes] = raw
        best = proba.argmax(axis=1)
        return ClassifierOutput([LABELS[i] for i in best], proba.max(axis=1), proba)

    def predict_series(
        self, t: np.ndarray, radiometer: np.ndarray, uv: np.ndarray, co_o2: np.ndarray,
    ) -> ClassifierOutput:
        return self.predict_features(build_features(t, radiometer, uv, co_o2))

    def predict_simulated(
        self, t: np.ndarray, series: dict[str, np.ndarray], seed: int = 0, noise: SensorNoise | None = None,
    ) -> ClassifierOutput:
        """Classify a solver run as the instruments would report it."""
        noise = noise or SensorNoise()
        rng = np.random.default_rng(seed)
        return self.predict_series(
            t,
            noise.apply(series["radiometer_w_m2"], "radiometer", rng),
            noise.apply(series["uv_intensity"], "uv", rng),
            noise.apply(series["co_o2_ratio"], "co_o2", rng),
        )


def load_metrics() -> dict[str, object] | None:
    if not METRICS_PATH.exists():
        return None
    return json.loads(METRICS_PATH.read_text(encoding="utf-8"))

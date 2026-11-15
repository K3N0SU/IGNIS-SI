"""Sensor noise model and feature construction shared by training and inference."""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np

LABELS: tuple[str, ...] = (
    "HOT_FLAME",
    "RADIATIVE_EXTINCTION",
    "INVISIBLE_COOL_FLAME",
    "RE_IGNITION_RISK",
    "NO_COMBUSTION",
)

FEATURE_NAMES: tuple[str, ...] = (
    "log10_radiometer",
    "log10_uv",
    "co_o2_ratio",
    "dlog10_radiometer_dt",
    "dlog10_uv_dt",
    "log10_uv_to_radiometer",
)

_RADIOMETER_FLOOR = 1.0e-3  # W m^-2
_UV_FLOOR = 1.0e-5
_SLOPE_WINDOW_S = 0.5


def label_index(regime: str) -> int:
    """Map a solver regime onto a classifier label."""
    if regime in ("EXTINGUISHED", "BURNOUT"):
        return LABELS.index("NO_COMBUSTION")
    return LABELS.index(regime)


@dataclass(frozen=True)
class SensorNoise:
    radiometer_relative: float = 0.04
    radiometer_floor: float = 2.0e-3  # W m^-2, thermopile noise-equivalent flux
    uv_relative: float = 0.06
    uv_floor: float = 2.0e-5  # intensifier dark signal, hot-flame units
    co_o2_absolute: float = 0.012

    def apply(self, signal: np.ndarray, channel: str, rng: np.random.Generator) -> np.ndarray:
        n = len(signal)
        if channel == "radiometer":
            noisy = signal * (1.0 + self.radiometer_relative * rng.standard_normal(n)) + self.radiometer_floor * rng.standard_normal(n)
        elif channel == "uv":
            noisy = signal * (1.0 + self.uv_relative * rng.standard_normal(n)) + self.uv_floor * rng.standard_normal(n)
        elif channel == "co_o2":
            # The gas analyser reads zero when nothing is reacting.
            active = signal > 0.0
            noisy = np.where(active, signal + self.co_o2_absolute * rng.standard_normal(n), np.abs(0.3 * self.co_o2_absolute * rng.standard_normal(n)))
        else:
            raise ValueError(f"unknown sensor channel: {channel}")
        return np.maximum(noisy, 0.0)

    def as_dict(self) -> dict[str, float]:
        return asdict(self)


def _slope(t: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Backward-difference slope over a fixed window; causal, so usable live."""
    dt = float(t[1] - t[0]) if len(t) > 1 else 1.0
    lag = max(int(round(_SLOPE_WINDOW_S / dt)), 1)
    out = np.zeros_like(values)
    out[lag:] = (values[lag:] - values[:-lag]) / (lag * dt)
    if lag < len(values):
        out[:lag] = (values[:lag] - values[0]) / np.maximum(t[:lag] - t[0], dt)
    return out


def build_features(t: np.ndarray, radiometer: np.ndarray, uv: np.ndarray, co_o2: np.ndarray) -> np.ndarray:
    log_rad = np.log10(np.maximum(radiometer, _RADIOMETER_FLOOR))
    log_uv = np.log10(np.maximum(uv, _UV_FLOOR))
    return np.column_stack(
        [log_rad, log_uv, co_o2, _slope(t, log_rad), _slope(t, log_uv), log_uv - log_rad]
    )

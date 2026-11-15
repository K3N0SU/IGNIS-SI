"""Synthesise the demo soundtrack: a calm ambient pad, written from scratch.

The piece is generated entirely from sine partials and filtered noise, so it
carries no third-party rights. Slow minor-key chords with long crossfades, a
soft sub bass, sparse bell tones and a synthetic hall reverb.

Usage:  python scripts/make_score.py [output.wav] [--seconds 30]
"""

from __future__ import annotations

import argparse
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

RATE = 48_000
A4 = 440.0


def hz(semitones_from_a4: float) -> float:
    return A4 * 2.0 ** (semitones_from_a4 / 12.0)


# Chords as semitone offsets from A4. A minor add9, F major 7, C add9, E minor 7.
PROGRESSION: list[tuple[list[int], int]] = [
    ([-24, -12, -9, -5, 2], -36),
    ([-28, -16, -9, -5, -1], -40),
    ([-21, -14, -9, -5, -2], -33),
    ([-29, -17, -10, -5, -2], -41),
]
BELL_NOTES = [14, 10, 7, 12, 3, 7, 14, 19]


def envelope(n: int, attack: float, release: float) -> np.ndarray:
    env = np.ones(n)
    a, r = int(attack * RATE), int(release * RATE)
    env[:a] = 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, a))
    env[n - r:] = 0.5 + 0.5 * np.cos(np.linspace(0.0, np.pi, r))
    return env


def pad_voice(freq: float, n: int, rng: np.random.Generator, pan: float) -> np.ndarray:
    t = np.arange(n) / RATE
    out = np.zeros((n, 2))
    for detune in (-0.0035, 0.0, 0.004):
        phase = rng.uniform(0.0, 2.0 * np.pi)
        drift = 1.0 + 0.0012 * np.sin(2.0 * np.pi * rng.uniform(0.05, 0.12) * t + phase)
        base = 2.0 * np.pi * freq * (1.0 + detune) * np.cumsum(drift) / RATE
        tone = np.sin(base + phase) + 0.32 * np.sin(2.0 * base) + 0.12 * np.sin(3.0 * base) + 0.05 * np.sin(4.0 * base)
        swell = 0.82 + 0.18 * np.sin(2.0 * np.pi * rng.uniform(0.06, 0.14) * t + phase)
        side = pan + 0.25 * detune / 0.004
        out[:, 0] += tone * swell * (0.5 - 0.5 * side)
        out[:, 1] += tone * swell * (0.5 + 0.5 * side)
    return out / 3.0


def bell(freq: float, seconds: float, rng: np.random.Generator) -> np.ndarray:
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    tone = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2.01 * t) * np.exp(-3.0 * t)
    tone += 0.12 * np.sin(2 * np.pi * freq * 3.02 * t) * np.exp(-6.0 * t)
    tone *= np.exp(-1.6 * t) * (1.0 - np.exp(-180.0 * t))
    pan = rng.uniform(-0.5, 0.5)
    return np.stack([tone * (0.5 - 0.5 * pan), tone * (0.5 + 0.5 * pan)], axis=1)


def hall(seconds: float, rng: np.random.Generator) -> np.ndarray:
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    ir = rng.standard_normal((n, 2)) * np.exp(-t / (seconds / 5.5))[:, None]
    ir = sosfilt(butter(2, 5200.0, "low", fs=RATE, output="sos"), ir, axis=0)
    ir[: int(0.012 * RATE)] *= np.linspace(0.0, 1.0, int(0.012 * RATE))[:, None]
    return ir / np.sqrt(np.sum(ir**2, axis=0, keepdims=True))


def render(seconds: float, seed: int = 21) -> np.ndarray:
    rng = np.random.default_rng(seed)
    total = int(seconds * RATE)
    mix = np.zeros((total + 6 * RATE, 2))
    chord_len = seconds / len(PROGRESSION)
    overlap = 2.6

    for i, (notes, bass) in enumerate(PROGRESSION):
        start = max(int((i * chord_len - overlap / 2) * RATE), 0)
        n = int((chord_len + overlap) * RATE)
        env = envelope(n, overlap, overlap)[:, None]
        chord = np.zeros((n, 2))
        for j, note in enumerate(notes):
            weight = 1.0 if j < 3 else 0.7
            chord += weight * pad_voice(hz(note), n, rng, pan=np.linspace(-0.6, 0.6, len(notes))[j])
        t = np.arange(n) / RATE
        sub = np.sin(2 * np.pi * hz(bass + 12) * t) * 0.20
        chord += np.stack([sub, sub], axis=1)
        mix[start:start + n] += chord * env * 0.16

    pad_filter = butter(2, 2600.0, "low", fs=RATE, output="sos")
    mix = sosfilt(pad_filter, mix, axis=0)

    bells = np.zeros_like(mix)
    step = seconds / len(BELL_NOTES)
    for i, note in enumerate(BELL_NOTES):
        at = int((1.6 + i * step + rng.uniform(-0.25, 0.25)) * RATE)
        tone = bell(hz(note), 3.5, rng) * 0.05
        if at + len(tone) < len(bells):
            bells[at:at + len(tone)] += tone
    mix += bells

    air = rng.standard_normal((len(mix), 2))
    air = sosfilt(butter(2, [2500.0, 7000.0], "band", fs=RATE, output="sos"), air, axis=0)
    slow = 0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * np.arange(len(mix)) / RATE)
    mix += air * slow[:, None] * 0.004

    wet = np.stack([fftconvolve(mix[:, c], hall(4.2, rng)[:, c])[: len(mix)] for c in range(2)], axis=1)
    out = (0.62 * mix + 0.5 * wet)[:total]

    fade_in, fade_out = int(1.5 * RATE), int(3.0 * RATE)
    out[:fade_in] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fade_in)))[:, None]
    out[-fade_out:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fade_out)))[:, None]
    out = sosfilt(butter(2, 28.0, "high", fs=RATE, output="sos"), out, axis=0)
    return out / np.max(np.abs(out)) * 0.7


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("output", nargs="?", default=str(Path(__file__).resolve().parent / ".capture" / "score.wav"))
    parser.add_argument("--seconds", type=float, default=30.0)
    args = parser.parse_args()
    audio = render(args.seconds)
    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes((np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes())
    print(f"{path}  {len(audio) / RATE:.2f} s  peak {np.max(np.abs(audio)):.2f}")


if __name__ == "__main__":
    main()

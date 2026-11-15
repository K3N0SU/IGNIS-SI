"""Print model behaviour across the droplet test matrix used for calibration.

Run from the repository root:  python scripts/calibration_report.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from physics.properties import FUELS, Ambient  # noqa: E402
from physics.droplet import adiabatic_flame_temperature, classical_burning_rate  # noqa: E402
from physics.solver import SimulationConfig, simulate  # noqa: E402


def row(label: str, cfg: SimulationConfig) -> None:
    t0 = time.perf_counter()
    r = simulate(cfg)
    ms = (time.perf_counter() - t0) * 1e3
    s = r.summary
    kinds = ">".join(f"{e.kind.replace('HOT_FLAME_EXTINCTION_', 'EXT_')}@{e.t:.1f}" for e in r.events[1:])
    print(
        f"{label:34s} Kh={s['mean_hot_burning_rate_mm2_s']} Kc={s['mean_cool_burning_rate_mm2_s']} "
        f"hot={s['hot_flame_duration_s']}s cool={s['cool_flame_duration_s']}s Dend={s['final_diameter_mm']} "
        f"peakQ={s['peak_heat_release_w']} [{ms:.0f} ms] {kinds}"
    )


def main() -> None:
    for key, fuel in FUELS.items():
        amb = Ambient(0.21, 1.0)
        print(f"{key}: K_classical={classical_burning_rate(fuel, amb) * 1e6:.3f} mm2/s  T_ad={adiabatic_flame_temperature(fuel, amb):.0f} K")
    for d0 in (1.5, 2.0, 2.5, 3.0, 3.5, 3.9, 4.5, 5.0):
        row(f"heptane air 1atm D0={d0}", SimulationConfig(d0_mm=d0))
    for u in (1, 2, 4, 6, 8, 10, 15, 25, 40):
        row(f"restore U={u} cm/s D0=3.9", SimulationConfig(d0_mm=3.9, airflow_cm_s=u, flow_mode="RESTORE_AFTER_EXTINCTION"))
    for u in (2, 5, 10, 20, 40, 80, 150):
        row(f"continuous U={u} cm/s D0=3.9", SimulationConfig(d0_mm=3.9, airflow_cm_s=u))
    for x in (0.14, 0.16, 0.18, 0.25, 0.30):
        row(f"O2={x} D0=3.9", SimulationConfig(d0_mm=3.9, x_o2=x))
    for p in (0.5, 0.7, 1.2):
        row(f"p={p} D0=3.9", SimulationConfig(d0_mm=3.9, pressure_atm=p))
    row("artemis 34%/0.56atm D0=3.9", SimulationConfig(d0_mm=3.9, x_o2=0.34, pressure_atm=0.56))
    for dil in ("CO2", "He"):
        row(f"diluent {dil} D0=3.9", SimulationConfig(d0_mm=3.9, diluent=dil))  # type: ignore[arg-type]
    for f in ("n-decane", "n-dodecane", "methanol"):
        row(f"{f} D0=3.9", SimulationConfig(fuel=f, d0_mm=3.9))  # type: ignore[arg-type]


if __name__ == "__main__":
    main()

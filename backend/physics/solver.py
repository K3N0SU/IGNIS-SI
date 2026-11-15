"""Event-driven coupled ODE solver for a single droplet burn.

State vector
    hot regime : y = [D^2, eta]   droplet diameter squared, flame standoff ratio
    cool regime: y = [D^2]

    dD^2/dt = -K(D, eta, U, ambient)
    d eta/dt = (eta_target - eta) / tau_d,   tau_d = c * D_f^2 / alpha

Each regime is integrated with an adaptive Runge-Kutta scheme until a terminal
event fires (Da crossing unity, second-stage ignition, burnout) or a schedule
breakpoint is reached (ventilation restart, end of an induction delay).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from math import exp, pi, sqrt
from typing import Callable, Literal

import numpy as np
from scipy.integrate import solve_ivp

from .damkohler import ExtinctionMode, classify_extinction, damkohler_cool, damkohler_hot
from .droplet import FlameState, cool_flame_state, hot_flame_state
from .low_flow import reignition_margin
from .properties import DEFAULT_CALIBRATION, FUELS, Ambient, DiluentKey, FuelKey, ModelCalibration

FlowMode = Literal["CONTINUOUS", "RESTORE_AFTER_EXTINCTION"]

RADIOMETER_DISTANCE_M = 0.10
SENSOR_LAG_S = 0.25
# Samples in this window after a radiative Da = 1 crossing are labelled as the
# extinction transient: the hot flame is collapsing and the sensor signals are
# relaxing toward their cool-flame or dark levels.
EXTINCTION_TRANSIENT_S = 1.2
REIGNITION_RISK_MARGIN_K = 45.0
BURNOUT_D2_FRACTION = 4.0e-4


class Regime(str, Enum):
    HOT_FLAME = "HOT_FLAME"
    RADIATIVE_EXTINCTION = "RADIATIVE_EXTINCTION"
    INVISIBLE_COOL_FLAME = "INVISIBLE_COOL_FLAME"
    RE_IGNITION_RISK = "RE_IGNITION_RISK"
    EXTINGUISHED = "EXTINGUISHED"
    BURNOUT = "BURNOUT"


@dataclass(frozen=True)
class SimulationConfig:
    fuel: FuelKey = "n-heptane"
    d0_mm: float = 3.9
    x_o2: float = 0.21
    pressure_atm: float = 1.0
    airflow_cm_s: float = 0.0
    flow_mode: FlowMode = "CONTINUOUS"
    restore_delay_s: float = 3.0
    diluent: DiluentKey = "N2"
    ambient_temperature: float = 295.0
    t_max_s: float = 60.0
    dt_s: float = 0.05

    @property
    def ambient(self) -> Ambient:
        return Ambient(self.x_o2, self.pressure_atm, self.ambient_temperature, self.diluent)


@dataclass(frozen=True)
class SimEvent:
    t: float
    kind: str
    detail: str


@dataclass
class SimulationResult:
    config: SimulationConfig
    t: np.ndarray
    series: dict[str, np.ndarray]
    regime: list[str]
    events: list[SimEvent]
    summary: dict[str, float | str | bool | None] = field(default_factory=dict)


@dataclass
class _Segment:
    mode: Literal["hot", "cool", "dead"]
    t0: float
    t1: float
    velocity: float
    sol: Callable[[float], np.ndarray] | None
    y_end: np.ndarray


def simulate(cfg: SimulationConfig, cal: ModelCalibration = DEFAULT_CALIBRATION) -> SimulationResult:
    fuel = FUELS[cfg.fuel]
    ambient = cfg.ambient
    d0 = cfg.d0_mm * 1e-3
    d2_min = BURNOUT_D2_FRACTION * d0**2
    u_set = cfg.airflow_cm_s * 1e-2
    continuous = cfg.flow_mode == "CONTINUOUS"

    segments: list[_Segment] = []
    events: list[SimEvent] = [SimEvent(0.0, "IGNITION", "Hot-wire igniters fired")]

    t = 0.0
    velocity = u_set if continuous else 0.0
    restore_at: float | None = None
    reignite_at: float | None = None
    first_extinction_t: float | None = None
    extinction_mode: ExtinctionMode | None = None
    reignition_count = 0

    def hot_state(y: np.ndarray, u: float) -> FlameState:
        return hot_flame_state(fuel, ambient, sqrt(max(y[0], 1e-14)), max(y[1], 1.05), u, cal)

    def cool_state(y: np.ndarray, u: float) -> FlameState:
        return cool_flame_state(fuel, ambient, sqrt(max(y[0], 1e-14)), u, cal)

    y = np.array([d0**2, cal.ignition_standoff])
    mode: Literal["hot", "cool", "dead"] = "hot"
    if damkohler_hot(hot_state(y, velocity), ambient, velocity, cal) < 1.0:
        mode = "dead"
        events.append(SimEvent(0.0, "IGNITION_FAILED", "Atmosphere cannot sustain a hot flame at this diameter"))

    for _ in range(24):
        if t >= cfg.t_max_s - 1e-9 or mode == "dead":
            break
        breakpoints = [cfg.t_max_s]
        if restore_at is not None and restore_at > t:
            breakpoints.append(restore_at)
        if reignite_at is not None and reignite_at > t:
            breakpoints.append(reignite_at)
        t_stop = min(breakpoints)
        u = velocity

        def burnout(_t: float, yy: np.ndarray) -> float:
            return yy[0] - d2_min

        burnout.terminal = True  # type: ignore[attr-defined]
        burnout.direction = -1  # type: ignore[attr-defined]

        if mode == "hot":

            def rhs(_t: float, yy: np.ndarray) -> list[float]:
                s = hot_state(yy, u)
                tau_d = cal.standoff_relax_coeff * s.flame_diameter**2 / s.diffusivity
                return [-s.burning_rate, (s.standoff_target - yy[1]) / tau_d]

            def extinction(_t: float, yy: np.ndarray) -> float:
                return damkohler_hot(hot_state(yy, u), ambient, u, cal) - 1.0

            extinction.terminal = True  # type: ignore[attr-defined]
            extinction.direction = -1  # type: ignore[attr-defined]
            event_fns = [extinction, burnout]
        else:

            def rhs(_t: float, yy: np.ndarray) -> list[float]:
                return [-cool_state(yy, u).burning_rate]

            def extinction(_t: float, yy: np.ndarray) -> float:
                return damkohler_cool(cool_state(yy, u), u, cal) - 1.0

            extinction.terminal = True  # type: ignore[attr-defined]
            extinction.direction = -1  # type: ignore[attr-defined]

            def reignition(_t: float, yy: np.ndarray) -> float:
                return reignition_margin(cfg.fuel, ambient, sqrt(max(yy[0], 1e-14)), u, cal)

            reignition.terminal = True  # type: ignore[attr-defined]
            reignition.direction = 1  # type: ignore[attr-defined]
            event_fns = [extinction, burnout]
            if reignite_at is None:
                event_fns.append(reignition)

        sol = solve_ivp(
            rhs, (t, t_stop), y, method="RK45", events=event_fns,
            dense_output=True, rtol=1e-6, atol=[1e-13, 1e-6][: len(y)], max_step=0.25,
        )
        t_end = float(sol.t[-1])
        y_end = sol.y[:, -1].copy()
        segments.append(_Segment(mode, t, t_end, u, sol.sol, y_end))
        fired = [i for i, te in enumerate(sol.t_events) if len(te) > 0]
        t = t_end
        d_now = sqrt(max(y_end[0], 1e-14))

        if 1 in fired:
            events.append(SimEvent(t, "BURNOUT", "Liquid fuel consumed"))
            mode = "dead"
            break

        if mode == "hot" and 0 in fired:
            state = hot_state(y_end, u)
            cause = classify_extinction(state, u, d_now / d0)
            if cause is ExtinctionMode.DIFFUSIVE:
                events.append(SimEvent(t, "BURNOUT", "Flame too small for the chemistry (Da < 1)"))
                mode = "dead"
                break
            if first_extinction_t is None:
                first_extinction_t = t
                extinction_mode = cause
                if not continuous:
                    restore_at = t + cfg.restore_delay_s
            label = "radiative heat loss" if cause is ExtinctionMode.RADIATIVE else "convective blowoff"
            events.append(SimEvent(t, f"HOT_FLAME_EXTINCTION_{cause.name}", f"Visible flame lost to {label} at D = {d_now * 1e3:.2f} mm"))
            y = y_end[:1].copy()
            if fuel.supports_cool_flame and damkohler_cool(cool_state(y, u), u, cal) > 1.0:
                mode = "cool"
                reignite_at = None
                events.append(SimEvent(t, "COOL_FLAME_ONSET", "Low-temperature flame continues with no visible emission"))
                if reignition_margin(cfg.fuel, ambient, d_now, u, cal) > 0.0:
                    reignite_at = t + cal.induction_time
            else:
                events.append(SimEvent(t, "FLAME_OUT", "No sustained low-temperature chemistry"))
                mode = "dead"
            continue

        if mode == "cool":
            if 0 in fired:
                events.append(SimEvent(t, "COOL_FLAME_EXTINCTION", f"Cool flame extinguished at D = {d_now * 1e3:.2f} mm"))
                mode = "dead"
                break
            if 2 in fired:
                reignite_at = t + cal.induction_time
                continue

        if restore_at is not None and abs(t - restore_at) < 1e-9:
            velocity = u_set
            restore_at = None
            events.append(SimEvent(t, "VENTILATION_RESTORED", f"Cabin airflow resumed at {cfg.airflow_cm_s:.1f} cm/s"))
            if mode == "cool" and reignite_at is None and reignition_margin(cfg.fuel, ambient, d_now, velocity, cal) > 0.0:
                reignite_at = t + cal.induction_time
            y = y_end.copy()
            continue

        if reignite_at is not None and abs(t - reignite_at) < 1e-9:
            reignite_at = None
            if mode == "cool" and reignition_margin(cfg.fuel, ambient, d_now, velocity, cal) > 0.0:
                reignition_count += 1
                events.append(SimEvent(t, "HOT_REIGNITION", f"Second-stage ignition of the hot flame at D = {d_now * 1e3:.2f} mm"))
                mode = "hot"
                y = np.array([y_end[0], cal.ignition_standoff])
            else:
                y = y_end.copy()
            continue

        y = y_end.copy()

    return _sample(cfg, cal, segments, events, first_extinction_t, extinction_mode, reignition_count)


def _lag(values: np.ndarray, dt: float, tau: float) -> np.ndarray:
    out = np.empty_like(values)
    a = 1.0 - exp(-dt / tau)
    acc = values[0]
    for i, v in enumerate(values):
        acc += a * (v - acc)
        out[i] = acc
    return out


def _sample(
    cfg: SimulationConfig,
    cal: ModelCalibration,
    segments: list[_Segment],
    events: list[SimEvent],
    first_extinction_t: float | None,
    extinction_mode: ExtinctionMode | None,
    reignition_count: int,
) -> SimulationResult:
    fuel = FUELS[cfg.fuel]
    ambient = cfg.ambient
    d0 = cfg.d0_mm * 1e-3
    t_burn = segments[-1].t1 if segments else 0.0
    t_final = min(cfg.t_max_s, t_burn + 3.0)
    n = int(round(t_final / cfg.dt_s)) + 1
    t = np.linspace(0.0, (n - 1) * cfg.dt_s, n)

    keys = (
        "d_mm", "d2_mm2", "flame_diameter_mm", "flame_temperature_k", "burning_rate_mm2_s",
        "damkohler_hot", "damkohler_cool", "heat_release_w", "radiative_fraction",
        "radiometer_w_m2", "uv_intensity", "visible_luminosity", "co_o2_ratio",
        "airflow_cm_s", "soot_shell_diameter_mm", "soot_mass_ug", "co_released_mg",
    )
    s: dict[str, np.ndarray] = {k: np.zeros(n) for k in keys}
    raw_mode: list[str] = ["dead"] * n
    risk = np.zeros(n, dtype=bool)

    seg_idx = 0
    d2_last = d0**2
    for i, ti in enumerate(t):
        while seg_idx < len(segments) - 1 and ti > segments[seg_idx].t1:
            seg_idx += 1
        seg = segments[seg_idx] if segments else None
        if seg is None or ti > seg.t1 or seg.sol is None:
            if seg is not None:
                d2_last = float(seg.y_end[0])
            d = sqrt(max(d2_last, 0.0))
            s["d_mm"][i] = d * 1e3
            s["d2_mm2"][i] = d2_last * 1e6
            s["flame_temperature_k"][i] = ambient.temperature
            s["airflow_cm_s"][i] = seg.velocity * 1e2 if seg is not None else 0.0
            continue

        y = seg.sol(ti)
        d2 = max(float(y[0]), 0.0)
        d = sqrt(max(d2, 1e-14))
        u = seg.velocity
        raw_mode[i] = seg.mode
        s["d_mm"][i] = d * 1e3
        s["d2_mm2"][i] = d2 * 1e6
        s["airflow_cm_s"][i] = u * 1e2

        if seg.mode == "hot":
            st = hot_flame_state(fuel, ambient, d, max(float(y[1]), 1.05), u, cal)
            da_h = damkohler_hot(st, ambient, u, cal)
            s["damkohler_hot"][i] = da_h
            s["uv_intensity"][i] = (st.heat_release / 50.0) * exp(9000.0 * (1.0 / 2000.0 - 1.0 / st.flame_temperature))
            s["visible_luminosity"][i] = (
                (st.heat_release / 50.0)
                * exp(12000.0 * (1.0 / 2000.0 - 1.0 / st.flame_temperature))
                * (0.25 + 0.75 * min(fuel.soot_index, 1.5))
            )
            s["co_o2_ratio"][i] = 0.02 + 0.10 * st.radiative_fraction**2
            co_yield = 0.010 + 0.05 * st.radiative_fraction**2
        else:
            st = cool_flame_state(fuel, ambient, d, u, cal)
            s["damkohler_cool"][i] = damkohler_cool(st, u, cal)
            hot_probe = hot_flame_state(fuel, ambient, d, cal.ignition_standoff, u, cal)
            s["damkohler_hot"][i] = damkohler_hot(hot_probe, ambient, u, cal)
            # Cool-flame UV emission is excited formaldehyde with a trace of
            # OH*; three to four orders of magnitude below a hot flame.
            s["uv_intensity"][i] = 4.0e-3 * (st.mass_rate / 1.0e-6) * exp(6000.0 * (1.0 / 700.0 - 1.0 / st.flame_temperature))
            s["visible_luminosity"][i] = 0.0
            s["co_o2_ratio"][i] = min(max(0.35 + 0.10 * (st.flame_temperature - 700.0) / 100.0, 0.2), 0.6)
            co_yield = 0.25
            risk[i] = st.flame_temperature >= cal.t_reignition - REIGNITION_RISK_MARGIN_K

        s["flame_diameter_mm"][i] = st.flame_diameter * 1e3
        s["flame_temperature_k"][i] = st.flame_temperature
        s["burning_rate_mm2_s"][i] = st.burning_rate * 1e6
        s["heat_release_w"][i] = st.heat_release
        s["radiative_fraction"][i] = st.radiative_fraction
        s["radiometer_w_m2"][i] = st.radiative_loss / (4.0 * pi * RADIOMETER_DISTANCE_M**2)
        s["co_released_mg"][i] = co_yield * st.mass_rate * 1e6  # rate, integrated below
        if seg.mode == "hot":
            # Soot forms in the fuel-rich region; yield grows with residence
            # time, which scales with the square of the flame diameter.
            soot_yield = 0.02 * fuel.soot_index * min((st.flame_diameter / 0.02) ** 2, 1.5)
            s["soot_mass_ug"][i] = soot_yield * st.mass_rate * 1e9
            s["soot_shell_diameter_mm"][i] = d * (1.0 + 0.3 * (st.standoff - 1.0)) * 1e3

    dt = cfg.dt_s
    s["co_released_mg"] = np.cumsum(s["co_released_mg"]) * dt
    soot_rate = s["soot_mass_ug"].copy()
    soot = np.zeros(n)
    shell = s["soot_shell_diameter_mm"]
    for i in range(1, n):
        # Without a hot flame the shell is no longer fed and disperses.
        decay = 0.0 if raw_mode[i] == "hot" else 1.0 / 8.0
        soot[i] = soot[i - 1] + dt * (soot_rate[i] - decay * soot[i - 1])
        if raw_mode[i] != "hot":
            shell[i] = shell[i - 1] * (1.0 + 0.02 * dt) if soot[i] > 1e-3 else 0.0
    s["soot_mass_ug"] = soot

    for key in ("radiometer_w_m2", "uv_intensity", "visible_luminosity", "flame_temperature_k", "flame_diameter_mm", "heat_release_w"):
        s[key] = _lag(s[key], dt, SENSOR_LAG_S)

    extinction_times = [e.t for e in events if e.kind == "HOT_FLAME_EXTINCTION_RADIATIVE"]
    regime: list[str] = []
    for i, ti in enumerate(t):
        in_window = any(te <= ti <= te + EXTINCTION_TRANSIENT_S for te in extinction_times)
        if raw_mode[i] == "hot":
            regime.append(Regime.RADIATIVE_EXTINCTION.value if in_window else Regime.HOT_FLAME.value)
        elif raw_mode[i] == "cool":
            if in_window:
                regime.append(Regime.RADIATIVE_EXTINCTION.value)
            elif risk[i]:
                regime.append(Regime.RE_IGNITION_RISK.value)
            else:
                regime.append(Regime.INVISIBLE_COOL_FLAME.value)
        elif in_window:
            regime.append(Regime.RADIATIVE_EXTINCTION.value)
        else:
            burned = s["d2_mm2"][i] <= 1.5 * BURNOUT_D2_FRACTION * (cfg.d0_mm**2) or any(e.kind == "BURNOUT" for e in events)
            regime.append(Regime.BURNOUT.value if burned else Regime.EXTINGUISHED.value)

    hot_mask = np.array([m == "hot" for m in raw_mode])
    cool_mask = np.array([m == "cool" for m in raw_mode])
    reign_times = [e.t for e in events if e.kind == "HOT_REIGNITION"]
    summary: dict[str, float | str | bool | None] = {
        "burn_time_s": round(t_burn, 3),
        "hot_flame_duration_s": round(float(hot_mask.sum() * dt), 3),
        "cool_flame_duration_s": round(float(cool_mask.sum() * dt), 3),
        "first_extinction_s": None if first_extinction_t is None else round(first_extinction_t, 3),
        "extinction_mode": None if extinction_mode is None else extinction_mode.value,
        "reignition_count": reignition_count,
        "first_reignition_s": round(reign_times[0], 3) if reign_times else None,
        "final_diameter_mm": round(float(s["d_mm"][-1]), 4),
        "fuel_consumed_fraction": round(1.0 - float(s["d_mm"][-1] / cfg.d0_mm) ** 3, 4),
        "peak_heat_release_w": round(float(s["heat_release_w"].max()), 2),
        "peak_flame_temperature_k": round(float(s["flame_temperature_k"].max()), 1),
        "mean_hot_burning_rate_mm2_s": round(float(s["burning_rate_mm2_s"][hot_mask].mean()), 4) if hot_mask.any() else None,
        "mean_cool_burning_rate_mm2_s": round(float(s["burning_rate_mm2_s"][cool_mask].mean()), 4) if cool_mask.any() else None,
        "co_released_mg": round(float(s["co_released_mg"][-1]), 4),
        "cool_flame_present": bool(cool_mask.any()),
        "final_regime": regime[-1],
    }
    return SimulationResult(cfg, t, s, regime, events, summary)

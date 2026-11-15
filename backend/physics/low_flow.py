"""Non-monotonic response of a microgravity droplet flame to slow forced flow.

In a quiescent microgravity environment oxidizer reaches the flame by
diffusion alone and the flame stands far from the droplet, so it radiates
from a large volume. A stream of a few cm/s has three competing effects:

  1. it compresses the flame standoff, cutting the radiating volume (~D_f^3)
     and raising the flame temperature;
  2. it raises the oxidizer supply (Sherwood number), which lifts the
     temperature of a cool flame toward the hot-ignition threshold;
  3. it adds strain 2U/D_f, which shortens the flow time.

Effects 1 and 2 dominate at 1-10 cm/s, so burn intensity rises with airflow
and an invisible cool flame can transition back to a hot flame. Effect 3
dominates at high velocity and ends in blowoff. The response is therefore
non-monotonic in U.
"""

from __future__ import annotations

from dataclasses import dataclass

from .damkohler import damkohler_cool, damkohler_hot
from .droplet import FlameState, cool_flame_state, hot_flame_state
from .properties import DEFAULT_CALIBRATION, FUELS, Ambient, FuelKey, ModelCalibration


@dataclass(frozen=True)
class FlowPoint:
    airflow_cm_s: float
    hot_sustained: bool
    cool_sustained: bool
    reignition: bool
    heat_release_w: float
    burning_rate_mm2_s: float
    flame_temperature_k: float
    cool_flame_temperature_k: float
    radiative_fraction: float
    damkohler_hot: float
    damkohler_cool: float
    standoff: float


def quasi_steady_hot_state(
    fuel_key: FuelKey, ambient: Ambient, diameter: float, velocity: float,
    cal: ModelCalibration = DEFAULT_CALIBRATION,
) -> FlameState:
    """Hot-flame state with the standoff relaxed to its quasi-steady target."""
    fuel = FUELS[fuel_key]
    standoff = cal.ignition_standoff
    state = hot_flame_state(fuel, ambient, diameter, standoff, velocity, cal)
    for _ in range(12):
        standoff = 0.5 * standoff + 0.5 * state.standoff_target
        state = hot_flame_state(fuel, ambient, diameter, standoff, velocity, cal)
    return state


def reignition_margin(
    fuel_key: FuelKey, ambient: Ambient, diameter: float, velocity: float,
    cal: ModelCalibration = DEFAULT_CALIBRATION,
) -> float:
    """Positive when a cool flame can transition to a hot flame.

    Requires both thermal runaway of the low-temperature chemistry (T_cf
    above the NTC ceiling) and a viable hot flame at the ignition standoff
    (Da_hot above the re-ignition threshold).
    """
    fuel = FUELS[fuel_key]
    if not fuel.supports_cool_flame:
        return -1.0
    cool = cool_flame_state(fuel, ambient, diameter, velocity, cal)
    hot = hot_flame_state(fuel, ambient, diameter, cal.ignition_standoff, velocity, cal)
    thermal = (cool.flame_temperature - cal.t_reignition) / cal.t_reignition
    kinetic = damkohler_hot(hot, ambient, velocity, cal) / cal.da_reignition - 1.0
    return min(thermal, kinetic)


def flow_response(
    fuel_key: FuelKey, ambient: Ambient, diameter: float, airflow_cm_s: list[float],
    cal: ModelCalibration = DEFAULT_CALIBRATION,
) -> list[FlowPoint]:
    """Quasi-steady burn intensity against airflow at a fixed droplet diameter."""
    fuel = FUELS[fuel_key]
    points: list[FlowPoint] = []
    for u_cm in airflow_cm_s:
        u = u_cm * 1e-2
        hot = quasi_steady_hot_state(fuel_key, ambient, diameter, u, cal)
        da_h = damkohler_hot(hot, ambient, u, cal)
        cool = cool_flame_state(fuel, ambient, diameter, u, cal)
        da_c = damkohler_cool(cool, u, cal) if fuel.supports_cool_flame else 0.0
        hot_ok = da_h > 1.0
        cool_ok = da_c > 1.0
        active = hot if hot_ok else cool
        burning = hot_ok or cool_ok
        points.append(
            FlowPoint(
                airflow_cm_s=u_cm,
                hot_sustained=hot_ok,
                cool_sustained=cool_ok,
                reignition=cool_ok and reignition_margin(fuel_key, ambient, diameter, u, cal) > 0.0,
                heat_release_w=active.heat_release if burning else 0.0,
                burning_rate_mm2_s=active.burning_rate * 1e6 if burning else 0.0,
                flame_temperature_k=hot.flame_temperature,
                cool_flame_temperature_k=cool.flame_temperature,
                radiative_fraction=hot.radiative_fraction,
                damkohler_hot=da_h,
                damkohler_cool=da_c,
                standoff=hot.standoff,
            )
        )
    return points


def critical_reignition_airflow(
    fuel_key: FuelKey, ambient: Ambient, diameter: float,
    cal: ModelCalibration = DEFAULT_CALIBRATION, upper_cm_s: float = 60.0,
) -> float | None:
    """Lowest airflow (cm/s) at which a cool flame re-ignites, by bisection."""
    if reignition_margin(fuel_key, ambient, diameter, 0.0, cal) > 0.0:
        return 0.0
    if reignition_margin(fuel_key, ambient, diameter, upper_cm_s * 1e-2, cal) <= 0.0:
        return None
    lo, hi = 0.0, upper_cm_s
    for _ in range(24):
        mid = 0.5 * (lo + hi)
        if reignition_margin(fuel_key, ambient, diameter, mid * 1e-2, cal) > 0.0:
            hi = mid
        else:
            lo = mid
    return hi

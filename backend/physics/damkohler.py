"""Damkohler-number extinction criteria.

Da = tau_flow / tau_chem, with extinction at Da < 1.

The flow time combines diffusive residence in the flame zone with the strain
imposed by a forced stream of velocity U:

    1 / tau_flow = alpha / D_f^2 + 2 U / D_f

The hot-flame chemical time is a one-step Arrhenius estimate,

    tau_chem = tau_0 * exp(T_a / T_f) * (0.232 / Y_O) / p

A single criterion therefore yields three distinct limits:
  * radiative (low strain): a large flame loses heat by radiation, T_f falls
    and tau_chem grows exponentially;
  * convective blowoff (high strain): 2U/D_f shortens tau_flow;
  * diffusive: a small droplet has a flame too thin for the chemistry.
"""

from __future__ import annotations

from enum import Enum
from math import exp

from .droplet import FlameState
from .properties import DEFAULT_CALIBRATION, Ambient, ModelCalibration


class ExtinctionMode(str, Enum):
    RADIATIVE = "RADIATIVE_LOW_STRAIN"
    WATER = "WATER_DILUTION"
    BLOWOFF = "CONVECTIVE_BLOWOFF"
    DIFFUSIVE = "DIFFUSIVE_BURNOUT"


def flow_time(flame_diameter: float, diffusivity: float, velocity: float) -> float:
    return 1.0 / (diffusivity / flame_diameter**2 + 2.0 * max(velocity, 0.0) / flame_diameter)


def strain_fraction(flame_diameter: float, diffusivity: float, velocity: float) -> float:
    """Share of the inverse flow time contributed by forced-flow strain."""
    strain = 2.0 * max(velocity, 0.0) / flame_diameter
    return strain / (strain + diffusivity / flame_diameter**2)


def hot_chemical_time(
    flame_temperature: float, ambient: Ambient, cal: ModelCalibration = DEFAULT_CALIBRATION
) -> float:
    exponent = min(cal.activation_temp_hot / max(flame_temperature, 300.0), 80.0)
    return cal.tau_chem_hot * exp(exponent) * (0.232 / ambient.y_o2) / ambient.pressure_atm


def cool_chemical_time(flame_temperature: float, cal: ModelCalibration = DEFAULT_CALIBRATION) -> float:
    """Low-temperature branch: rate rises with temperature below the NTC turnover."""
    exponent = cal.activation_temp_cool * (1.0 / flame_temperature - 1.0 / cal.t_cool_base)
    return cal.tau_chem_cool * exp(min(max(exponent, -40.0), 40.0))


def damkohler_hot(
    state: FlameState, ambient: Ambient, velocity: float, cal: ModelCalibration = DEFAULT_CALIBRATION
) -> float:
    tau_flow = flow_time(state.flame_diameter, state.diffusivity, velocity)
    return tau_flow / (state.chem_time_factor * hot_chemical_time(state.flame_temperature, ambient, cal))


def damkohler_cool(
    state: FlameState, velocity: float, cal: ModelCalibration = DEFAULT_CALIBRATION
) -> float:
    tau_flow = flow_time(state.flame_diameter, state.diffusivity, velocity)
    return tau_flow / cool_chemical_time(state.flame_temperature, cal)


def classify_extinction(state: FlameState, velocity: float, diameter_ratio: float) -> ExtinctionMode:
    """Attribute a hot-flame Da < 1 crossing to its controlling loss mechanism."""
    if strain_fraction(state.flame_diameter, state.diffusivity, velocity) > 0.5 and state.radiative_fraction < 0.35:
        return ExtinctionMode.BLOWOFF
    if diameter_ratio <= 0.2:
        return ExtinctionMode.DIFFUSIVE
    if state.water_fraction > 0.15 and state.radiative_fraction < 0.45:
        return ExtinctionMode.WATER
    return ExtinctionMode.RADIATIVE

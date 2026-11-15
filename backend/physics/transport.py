"""Gas-phase transport properties and convective correlations."""

from __future__ import annotations

from math import log, sqrt

from .properties import ATM_PA, PRANDTL, R_UNIVERSAL, Ambient, Fuel

_LAMBDA_N2_300 = 0.0262  # W m^-1 K^-1


def ambient_conductivity(ambient: Ambient, temperature: float) -> float:
    """Conductivity of the O2/diluent mixture, linear in diluent mole fraction."""
    base = _LAMBDA_N2_300 * (temperature / 300.0) ** 0.8
    ratio = ambient.diluent_props.lambda_ratio
    return base * (ambient.x_o2 + (1.0 - ambient.x_o2) * ratio)


def gas_density(ambient: Ambient, temperature: float) -> float:
    return ambient.pressure_atm * ATM_PA * ambient.molar_mass / (R_UNIVERSAL * temperature)


def thermal_diffusivity(ambient: Ambient, temperature: float) -> float:
    return ambient_conductivity(ambient, temperature) / (gas_density(ambient, temperature) * ambient.cp)


def kinematic_viscosity(ambient: Ambient, temperature: float) -> float:
    return PRANDTL * thermal_diffusivity(ambient, temperature)


def film_conductivity(fuel: Fuel, ambient: Ambient, temperature: float) -> float:
    return 0.4 * fuel.vapor_lambda(temperature) + 0.6 * ambient_conductivity(ambient, temperature)


def reynolds(velocity: float, diameter: float, nu: float) -> float:
    return max(velocity, 0.0) * diameter / nu


def frossling_factor(re: float, transfer_number: float | None = None) -> float:
    """Convective enhancement of the transfer rate over the stagnant-film value.

    Frossling: Nu/Nu_0 = 1 + 0.276 Re^1/2 Pr^1/3. When a Spalding transfer
    number is supplied, the enhancement is reduced by the Abramzon-Sirignano
    film-thickening function F(B) = (1+B)^0.7 ln(1+B)/B, which accounts for
    Stefan flow blowing the boundary layer away from the surface.
    """
    gain = 0.276 * sqrt(max(re, 0.0)) * PRANDTL ** (1.0 / 3.0)
    if transfer_number is not None and transfer_number > 1e-6:
        b = transfer_number
        gain /= (1.0 + b) ** 0.7 * log(1.0 + b) / b
    return 1.0 + gain

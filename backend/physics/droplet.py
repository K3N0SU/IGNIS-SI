"""Quasi-steady spherical droplet combustion: hot-flame and cool-flame branches.

Hot branch. The classical d^2-law gives D^2(t) = D0^2 - K t with

    K = 8 lambda_g / (rho_l c_pg) * ln(1 + B)

where the logarithm is the Stefan-flow solution for a surface with blowing.
For a burning droplet the Spalding transfer number is

    B = [c_pg (T_inf - T_b) + (1 - chi_r) Y_O,inf Q / s] / h_fg

which reduces to the pure-vaporisation form c_pg (T_inf - T_b) / h_fg when
no oxidizer is present. chi_r is the fraction of the heat release lost by
gas radiation. For an optically thin flame ball of diameter D_f,

    Q_rad = (pi/6) D_f^3 * 4 sigma kappa_P (T_f^4 - T_inf^4)

so Q_rad scales as D^3 T^4 while heat release scales as D; the radiative
fraction therefore grows as D^2 and large droplets extinguish radiatively.

Cool branch. The low-temperature flame is kinetically pinned near the NTC
turnover, so the transfer number is set by conduction from a sheet at T_cf
located at a finite standoff ratio eta:

    K = 8 lambda_g / (rho_l c_pg) * ln(1 + c_pg (T_cf - T_b) / h_fg) / (1 - 1/eta)
"""

from __future__ import annotations

from dataclasses import dataclass
from math import log, pi, sqrt

from .properties import (
    AIR_CP,
    DEFAULT_CALIBRATION,
    SCHMIDT,
    SIGMA_SB,
    Ambient,
    Fuel,
    ModelCalibration,
)
from .transport import (
    film_conductivity,
    frossling_factor,
    kinematic_viscosity,
    reynolds,
    thermal_diffusivity,
)

_COOL_FILM_T = 560.0


@dataclass(frozen=True)
class FlameState:
    burning_rate: float  # K, m^2 s^-1
    transfer_number: float
    mass_rate: float  # kg s^-1
    flame_temperature: float  # K
    standoff: float  # D_f / D
    standoff_target: float
    flame_diameter: float  # m
    heat_release: float  # W
    radiative_loss: float  # W
    radiative_fraction: float
    reynolds: float
    convective_factor: float
    diffusivity: float  # m^2 s^-1 at the film temperature


def adiabatic_flame_temperature(
    fuel: Fuel, ambient: Ambient, cal: ModelCalibration = DEFAULT_CALIBRATION
) -> float:
    """Burke-Schumann flame-sheet temperature with a smooth dissociation ceiling."""
    y_o = ambient.y_o2
    cp_products = cal.product_cp * ambient.cp / AIR_CP
    rise = (fuel.heat_of_combustion / fuel.stoich_o2_mass) * y_o / (
        cp_products * (1.0 + y_o / fuel.stoich_o2_mass)
    )
    rise /= (1.0 + (rise / cal.dissociation_cap) ** 6) ** (1.0 / 6.0)
    return ambient.temperature + rise


def classical_burning_rate(fuel: Fuel, ambient: Ambient, flame_temperature: float | None = None) -> float:
    """Non-radiating, stagnant-ambient d^2-law burning-rate constant."""
    t_b = fuel.boiling_point(ambient.pressure_atm)
    t_f = flame_temperature if flame_temperature is not None else adiabatic_flame_temperature(fuel, ambient)
    t_film = 0.5 * (t_f + t_b)
    lam = film_conductivity(fuel, ambient, t_film)
    cp = fuel.vapor_cp(t_film)
    b = (cp * (ambient.temperature - t_b) + ambient.y_o2 * fuel.heat_of_combustion / fuel.stoich_o2_mass) / fuel.h_fg
    return 8.0 * lam / (fuel.rho_liquid * cp) * log(1.0 + max(b, 0.0))


def hot_flame_state(
    fuel: Fuel,
    ambient: Ambient,
    diameter: float,
    standoff: float,
    velocity: float,
    cal: ModelCalibration = DEFAULT_CALIBRATION,
) -> FlameState:
    t_inf = ambient.temperature
    t_b = fuel.boiling_point(ambient.pressure_atm)
    t_ad = adiabatic_flame_temperature(fuel, ambient, cal)
    y_o = ambient.y_o2
    q_per_o2 = fuel.heat_of_combustion / fuel.stoich_o2_mass
    kappa = cal.kappa_planck * ambient.pressure_atm * ambient.diluent_props.kappa_factor
    flame_diameter = standoff * diameter
    volume = pi / 6.0 * flame_diameter**3

    chi = 0.3
    t_f = t_ad
    k = b = mdot = q_gen = q_rad = re = conv = alpha = 0.0
    # Damped fixed point on the radiative fraction: T_f, the film properties,
    # B and K all depend on chi_r, and chi_r depends on K through Q_gen.
    for _ in range(8):
        t_f = t_inf + (t_ad - t_inf) * (1.0 - chi)
        t_film = 0.5 * (t_f + t_b)
        lam = film_conductivity(fuel, ambient, t_film)
        cp = fuel.vapor_cp(t_film)
        b = max((cp * (t_inf - t_b) + (1.0 - chi) * y_o * q_per_o2) / fuel.h_fg, 1e-3)
        alpha = thermal_diffusivity(ambient, t_film)
        re = reynolds(velocity, diameter, kinematic_viscosity(ambient, t_film))
        conv = frossling_factor(re, b)
        k = 8.0 * lam / (fuel.rho_liquid * cp) * log(1.0 + b) * conv
        mdot = 0.25 * pi * fuel.rho_liquid * diameter * k
        q_gen = mdot * fuel.heat_of_combustion
        q_rad = volume * 4.0 * SIGMA_SB * kappa * max(t_f**4 - t_inf**4, 0.0)
        chi_new = min(q_rad / max(q_gen, 1e-12), 0.95)
        chi = 0.5 * chi + 0.5 * chi_new

    # Quasi-steady flame position r_f/r_s = ln(1+B)/ln(1+Y_O/s) overpredicts
    # the observed standoff because fuel vapour accumulates between droplet
    # and flame; forced flow compresses the standoff further.
    eta_classic = log(1.0 + b) / log(1.0 + y_o / fuel.stoich_o2_mass)
    eta_quiescent = 1.0 + cal.accumulation_factor * (eta_classic - 1.0)
    peclet = max(velocity, 0.0) * diameter * eta_quiescent / alpha
    eta_target = max(1.0 + (eta_quiescent - 1.0) / (1.0 + cal.standoff_peclet_coeff * sqrt(peclet)), 1.3)

    return FlameState(
        burning_rate=k,
        transfer_number=b,
        mass_rate=mdot,
        flame_temperature=t_f,
        standoff=standoff,
        standoff_target=eta_target,
        flame_diameter=flame_diameter,
        heat_release=q_gen,
        radiative_loss=min(q_rad, 0.95 * q_gen),
        radiative_fraction=chi,
        reynolds=re,
        convective_factor=conv,
        diffusivity=alpha,
    )


def oxidizer_supply_factor(ambient: Ambient, diameter: float, velocity: float) -> float:
    """Oxidizer delivery to a diffusion-limited flame relative to still air at 1 atm.

    Phi = (X_O2 / 0.21) * p^1/2 * Sh/Sh_0, with the Sherwood enhancement from
    the Frossling correlation at the cool-flame film temperature.
    """
    nu = kinematic_viscosity(ambient, _COOL_FILM_T)
    re = reynolds(velocity, diameter, nu)
    sherwood = 1.0 + 0.276 * sqrt(re) * SCHMIDT ** (1.0 / 3.0)
    return (ambient.x_o2 / 0.21) * sqrt(ambient.pressure_atm) * sherwood


def cool_flame_temperature(
    ambient: Ambient, diameter: float, velocity: float, cal: ModelCalibration = DEFAULT_CALIBRATION
) -> float:
    phi = oxidizer_supply_factor(ambient, diameter, velocity)
    t = cal.t_cool_base + cal.t_cool_gain * (phi - 1.0)
    return min(max(t, cal.t_cool_min), cal.t_cool_max)


def cool_flame_state(
    fuel: Fuel,
    ambient: Ambient,
    diameter: float,
    velocity: float,
    cal: ModelCalibration = DEFAULT_CALIBRATION,
) -> FlameState:
    t_inf = ambient.temperature
    t_b = fuel.boiling_point(ambient.pressure_atm)
    t_cf = cool_flame_temperature(ambient, diameter, velocity, cal)
    t_film = 0.5 * (t_cf + t_b)
    lam = film_conductivity(fuel, ambient, t_film)
    cp = fuel.vapor_cp(t_film)
    alpha = thermal_diffusivity(ambient, t_film)
    re = reynolds(velocity, diameter, kinematic_viscosity(ambient, t_film))

    peclet = max(velocity, 0.0) * diameter * cal.cool_standoff / alpha
    eta = max(1.0 + (cal.cool_standoff - 1.0) / (1.0 + 0.1 * sqrt(peclet)), 1.5)
    b = max(cp * (t_cf - t_b) / fuel.h_fg, 1e-3)
    k = 8.0 * lam / (fuel.rho_liquid * cp) * log(1.0 + b) / (1.0 - 1.0 / eta)
    mdot = 0.25 * pi * fuel.rho_liquid * diameter * k
    flame_diameter = eta * diameter
    kappa = cal.kappa_cool * ambient.pressure_atm
    q_rad = pi / 6.0 * flame_diameter**3 * 4.0 * SIGMA_SB * kappa * max(t_cf**4 - t_inf**4, 0.0)
    # Low-temperature oxidation releases roughly a tenth of the full heat of
    # combustion; the remainder leaves as CO, CH2O and unburned intermediates.
    q_gen = 0.12 * mdot * fuel.heat_of_combustion

    return FlameState(
        burning_rate=k,
        transfer_number=b,
        mass_rate=mdot,
        flame_temperature=t_cf,
        standoff=eta,
        standoff_target=eta,
        flame_diameter=flame_diameter,
        heat_release=q_gen,
        radiative_loss=min(q_rad, q_gen),
        radiative_fraction=min(q_rad / max(q_gen, 1e-12), 1.0),
        reynolds=re,
        convective_factor=1.0,
        diffusivity=alpha,
    )

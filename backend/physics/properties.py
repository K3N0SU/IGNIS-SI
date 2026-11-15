"""Thermophysical property data and model calibration constants.

Liquid and vapour properties are standard handbook values (NIST WebBook,
Yaws). Gas-phase transport follows the Law & Williams (1972) mixing rule used
throughout the droplet-combustion literature: film conductivity is
0.4*lambda_fuel + 0.6*lambda_ambient and film heat capacity is that of the
fuel vapour, both evaluated at the arithmetic mean of flame and boiling
temperatures.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import log
from typing import Literal

SIGMA_SB = 5.670374419e-8  # W m^-2 K^-4
R_UNIVERSAL = 8.314462618  # J mol^-1 K^-1
ATM_PA = 101_325.0
M_O2 = 31.998e-3  # kg mol^-1
CP_O2 = 1090.0  # J kg^-1 K^-1, mean over 300-2000 K
PRANDTL = 0.70
SCHMIDT = 0.70

FuelKey = Literal["n-heptane", "n-decane", "n-dodecane", "methanol"]
DiluentKey = Literal["N2", "CO2", "He"]


@dataclass(frozen=True)
class Fuel:
    key: FuelKey
    name: str
    formula: str
    rho_liquid: float  # kg m^-3 at 298 K
    t_boil: float  # K at 1 atm
    h_fg: float  # J kg^-1 at the normal boiling point
    heat_of_combustion: float  # J kg^-1, lower heating value
    stoich_o2_mass: float  # kg O2 per kg fuel
    vapor_lambda_300: float  # W m^-1 K^-1
    vapor_lambda_exp: float
    vapor_cp_300: float  # J kg^-1 K^-1
    vapor_cp_slope: float  # J kg^-1 K^-2
    vapor_cp_max: float
    supports_cool_flame: bool
    soot_index: float  # relative sooting propensity, n-heptane = 1

    def vapor_cp(self, temperature: float) -> float:
        cp = self.vapor_cp_300 + self.vapor_cp_slope * (temperature - 300.0)
        return min(max(cp, self.vapor_cp_300), self.vapor_cp_max)

    def vapor_lambda(self, temperature: float) -> float:
        return self.vapor_lambda_300 * (temperature / 300.0) ** self.vapor_lambda_exp

    def boiling_point(self, pressure_atm: float) -> float:
        """Clausius-Clapeyron shift of the boiling point with chamber pressure."""
        molar_mass = _FUEL_MOLAR_MASS[self.key]
        inv_t = 1.0 / self.t_boil - R_UNIVERSAL * log(max(pressure_atm, 1e-9)) / (self.h_fg * molar_mass)
        return 1.0 / inv_t


_FUEL_MOLAR_MASS: dict[str, float] = {
    "n-heptane": 100.20e-3,
    "n-decane": 142.28e-3,
    "n-dodecane": 170.33e-3,
    "methanol": 32.04e-3,
}

FUELS: dict[str, Fuel] = {
    "n-heptane": Fuel(
        key="n-heptane", name="n-Heptane", formula="C7H16",
        rho_liquid=684.0, t_boil=371.6, h_fg=3.16e5,
        heat_of_combustion=44.6e6, stoich_o2_mass=3.52,
        vapor_lambda_300=0.0125, vapor_lambda_exp=1.8,
        vapor_cp_300=1650.0, vapor_cp_slope=2.9, vapor_cp_max=4300.0,
        supports_cool_flame=True, soot_index=1.0,
    ),
    "n-decane": Fuel(
        key="n-decane", name="n-Decane", formula="C10H22",
        rho_liquid=730.0, t_boil=447.3, h_fg=2.77e5,
        heat_of_combustion=44.2e6, stoich_o2_mass=3.49,
        vapor_lambda_300=0.0115, vapor_lambda_exp=1.8,
        vapor_cp_300=1640.0, vapor_cp_slope=2.9, vapor_cp_max=4300.0,
        supports_cool_flame=True, soot_index=1.25,
    ),
    "n-dodecane": Fuel(
        key="n-dodecane", name="n-Dodecane", formula="C12H26",
        rho_liquid=750.0, t_boil=489.5, h_fg=2.56e5,
        heat_of_combustion=44.1e6, stoich_o2_mass=3.48,
        vapor_lambda_300=0.0110, vapor_lambda_exp=1.8,
        vapor_cp_300=1640.0, vapor_cp_slope=2.9, vapor_cp_max=4300.0,
        supports_cool_flame=True, soot_index=1.4,
    ),
    "methanol": Fuel(
        key="methanol", name="Methanol", formula="CH3OH",
        rho_liquid=791.0, t_boil=337.8, h_fg=1.10e6,
        heat_of_combustion=19.9e6, stoich_o2_mass=1.50,
        vapor_lambda_300=0.0157, vapor_lambda_exp=1.7,
        vapor_cp_300=1370.0, vapor_cp_slope=1.9, vapor_cp_max=3200.0,
        supports_cool_flame=False, soot_index=0.02,
    ),
}


@dataclass(frozen=True)
class Diluent:
    key: DiluentKey
    name: str
    molar_mass: float  # kg mol^-1
    cp: float  # J kg^-1 K^-1, mean over the flame temperature range
    lambda_ratio: float  # conductivity of pure diluent relative to N2
    kappa_factor: float  # multiplier on product Planck-mean absorption


DILUENTS: dict[str, Diluent] = {
    "N2": Diluent("N2", "Nitrogen", 28.013e-3, 1180.0, 1.0, 1.0),
    "CO2": Diluent("CO2", "Carbon dioxide", 44.010e-3, 1250.0, 0.82, 1.6),
    "He": Diluent("He", "Helium", 4.0026e-3, 5193.0, 4.4, 0.9),
}


@dataclass(frozen=True)
class Ambient:
    x_o2: float  # oxygen mole fraction
    pressure_atm: float
    temperature: float = 295.0
    diluent: DiluentKey = "N2"

    @property
    def diluent_props(self) -> Diluent:
        return DILUENTS[self.diluent]

    @property
    def molar_mass(self) -> float:
        return self.x_o2 * M_O2 + (1.0 - self.x_o2) * self.diluent_props.molar_mass

    @property
    def y_o2(self) -> float:
        return self.x_o2 * M_O2 / self.molar_mass

    @property
    def cp(self) -> float:
        y = self.y_o2
        return y * CP_O2 + (1.0 - y) * self.diluent_props.cp


AIR_CP = Ambient(0.21, 1.0).cp


@dataclass(frozen=True)
class ModelCalibration:
    """Closure constants of the reduced-order model.

    These are not flight measurements. They are tuned so the model reproduces
    the published behaviour of ISS droplet tests: quasi-steady n-heptane
    burning-rate constants of 0.5-0.8 mm^2/s, flame standoff ratios of 6-10,
    radiative extinction of hot flames for initial diameters above roughly
    3 mm in air at 1 atm, and second-stage cool-flame burning that ends at a
    diameter near 1.3 mm.
    """

    # Hot flame
    accumulation_factor: float = 0.27  # fuel-vapour accumulation correction to the quasi-steady standoff
    standoff_peclet_coeff: float = 0.30  # convective compression of the flame standoff
    standoff_relax_coeff: float = 2.5  # flame-growth time in units of D_f^2 / alpha
    ignition_standoff: float = 2.5  # flame standoff ratio left by the hot-wire igniters
    kappa_planck: float = 3.3  # m^-1 atm^-1, effective Planck-mean absorption of products
    product_cp: float = 1400.0  # J kg^-1 K^-1, products of combustion in air
    dissociation_cap: float = 2750.0  # K, ceiling on the adiabatic temperature rise
    tau_chem_hot: float = 3.7e-9  # s, pre-exponential chemical time
    activation_temp_hot: float = 29_000.0  # K
    # Cool flame
    t_cool_base: float = 700.0  # K, flame temperature at the low-temperature turnover
    t_cool_gain: float = 220.0  # K per unit oxidizer-supply factor
    t_cool_min: float = 600.0
    t_cool_max: float = 900.0
    cool_standoff: float = 3.0
    tau_chem_cool: float = 0.23  # s at t_cool_base
    activation_temp_cool: float = 12_000.0  # K
    kappa_cool: float = 3.0  # m^-1 atm^-1
    # Second-stage ignition
    t_reignition: float = 800.0  # K, upper bound of the NTC region
    da_reignition: float = 1.5
    induction_time: float = 0.5  # s

    def perturbed(self, scale: dict[str, float]) -> "ModelCalibration":
        values = {k: getattr(self, k) * scale.get(k, 1.0) for k in self.__dataclass_fields__}
        return ModelCalibration(**values)


DEFAULT_CALIBRATION = ModelCalibration()

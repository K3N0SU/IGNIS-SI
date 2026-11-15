"""Thermophysical property data and model calibration constants.

Liquid and vapour properties are standard handbook values (NIST WebBook,
Yaws). Gas-phase transport follows the Law & Williams (1972) mixing rule used
throughout the droplet-combustion literature: film conductivity is
0.4*lambda_fuel + 0.6*lambda_ambient and film heat capacity is that of the
fuel vapour, both evaluated at the arithmetic mean of flame and boiling
temperatures.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, fields, replace
from math import log
from pathlib import Path
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
    absorbs_water: bool = False  # liquid is miscible with the water produced by the flame

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
        supports_cool_flame=False, soot_index=0.02, absorbs_water=True,
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
    """Chamber atmosphere: oxygen plus one diluent or an N2/CO2/He blend.

    ``diluent`` names the single balance gas. When ``x_co2`` or ``x_he`` is
    given, the balance is a blend with those mole fractions and nitrogen as
    the remainder, which is how the FLEX test matrix is specified.
    """

    x_o2: float  # oxygen mole fraction
    pressure_atm: float
    temperature: float = 295.0
    diluent: DiluentKey = "N2"
    x_co2: float | None = None
    x_he: float | None = None

    def __post_init__(self) -> None:
        # Derived mixture properties are fixed for the life of the object and
        # are read on every right-hand-side evaluation, so compute them once.
        balance = max(1.0 - self.x_o2, 1e-9)
        if self.x_co2 is None and self.x_he is None:
            n2 = 1.0 if self.diluent == "N2" else 0.0
            co2 = 1.0 if self.diluent == "CO2" else 0.0
            he = 1.0 if self.diluent == "He" else 0.0
        else:
            co2_abs = min(max(self.x_co2 or 0.0, 0.0), balance)
            he_abs = min(max(self.x_he or 0.0, 0.0), balance - co2_abs)
            n2, co2, he = (balance - co2_abs - he_abs) / balance, co2_abs / balance, he_abs / balance

        d_n2, d_co2, d_he = DILUENTS["N2"], DILUENTS["CO2"], DILUENTS["He"]
        dil_mass = n2 * d_n2.molar_mass + co2 * d_co2.molar_mass + he * d_he.molar_mass
        dil_cp = (n2 * d_n2.molar_mass * d_n2.cp + co2 * d_co2.molar_mass * d_co2.cp + he * d_he.molar_mass * d_he.cp) / dil_mass
        props = Diluent(
            key=self.diluent,
            name="blend",
            molar_mass=dil_mass,
            cp=dil_cp,
            lambda_ratio=n2 * d_n2.lambda_ratio + co2 * d_co2.lambda_ratio + he * d_he.lambda_ratio,
            kappa_factor=n2 * d_n2.kappa_factor + co2 * d_co2.kappa_factor + he * d_he.kappa_factor,
        )
        molar_mass = self.x_o2 * M_O2 + (1.0 - self.x_o2) * dil_mass
        y_o2 = self.x_o2 * M_O2 / molar_mass
        cache = {
            "_fractions": {"N2": n2, "CO2": co2, "He": he},
            "_props": props,
            "_molar_mass": molar_mass,
            "_y_o2": y_o2,
            "_cp": y_o2 * CP_O2 + (1.0 - y_o2) * dil_cp,
        }
        for name, value in cache.items():
            object.__setattr__(self, name, value)

    @property
    def diluent_fractions(self) -> dict[str, float]:
        """Mole fractions of N2, CO2 and He normalised over the non-oxygen part."""
        return self._fractions  # type: ignore[attr-defined, no-any-return]

    @property
    def diluent_props(self) -> Diluent:
        return self._props  # type: ignore[attr-defined, no-any-return]

    @property
    def molar_mass(self) -> float:
        return self._molar_mass  # type: ignore[attr-defined, no-any-return]

    @property
    def y_o2(self) -> float:
        return self._y_o2  # type: ignore[attr-defined, no-any-return]

    @property
    def cp(self) -> float:
        return self._cp  # type: ignore[attr-defined, no-any-return]


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
    # Fuel- and diluent-specific closures, fitted to the FLEX flight table
    methanol_chem_factor: float = 1.0  # chemical time of methanol relative to n-heptane
    methanol_kappa_factor: float = 1.0  # radiation of a soot-free methanol flame relative to n-heptane
    co2_kappa_factor: float = 1.6  # Planck-mean absorption of a CO2-diluted flame relative to N2
    water_absorption: float = 0.35  # liquid volume of water absorbed per volume of methanol burned
    water_exponent: float = 1.0  # sensitivity of flame temperature to liquid water fraction
    conductivity_scale: float = 1.0  # multiplier on the film conductivity

    def perturbed(self, scale: dict[str, float]) -> "ModelCalibration":
        values = {k: getattr(self, k) * scale.get(k, 1.0) for k in self.__dataclass_fields__}
        return ModelCalibration(**values)


BASELINE_CALIBRATION = ModelCalibration()
"""Hand-set constants used as the starting point of the flight-data fit."""

_FIT_PATH = Path(__file__).resolve().parents[1] / "data" / "calibration_fit.json"


def load_fitted_calibration(path: Path = _FIT_PATH) -> ModelCalibration:
    """Baseline constants overridden by the values fitted to FLEX flight data."""
    if not path.exists():
        return BASELINE_CALIBRATION
    fitted = json.loads(path.read_text(encoding="utf-8")).get("parameters", {})
    known = {f.name for f in fields(ModelCalibration)}
    return replace(BASELINE_CALIBRATION, **{k: float(v) for k, v in fitted.items() if k in known})


DEFAULT_CALIBRATION = load_fitted_calibration()

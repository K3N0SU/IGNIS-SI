"""Smoke-aerosol coagulation and detector response (SAME-class physics).

Number balance. The Smoluchowski equation is solved on a geometric volume
grid (bin k holds aggregates of n_k = 2^k primary particles) with the
fixed-pivot method of Kumar & Ramkrishna (1996), which conserves both number
and mass in every collision:

    dN_k/dt = sum_{i<=j} (1 - delta_ij/2) w_ijk beta_ij N_i N_j
              - N_k sum_i beta_ik N_i - N_k / tau_res

Kernel. Brownian coagulation in the continuum regime with the Cunningham
slip correction,

    beta_ij = (2 k_B T / 3 mu) (d_i + d_j) (C_i/d_i + C_j/d_j)

using the collision diameter of a fractal aggregate, d = d_p (n/k_f)^(1/D_f).

Residence time. In normal gravity a buoyant plume carries smoke away from
the source and dilutes it within about a second, freezing the size
distribution. In microgravity there is no plume; smoke stays concentrated
near the source until ventilation removes it, so coagulation proceeds for
minutes and the aggregates grow past 1 um.

Detectors.
  * Ionization chamber: response proportional to the first diameter moment,
    sum(N d).
  * Photoelectric (light scattering): Rayleigh-Debye-Gans theory for fractal
    aggregates, C_sca = n^2 C_p G(k R_g) with
    G = (1 + 4 k^2 R_g^2 / (3 D_f))^(-D_f/2)  (Dobbins & Megaridis 1991).
"""

from __future__ import annotations

from dataclasses import dataclass
from math import pi

import numpy as np
from scipy.integrate import solve_ivp

K_BOLTZMANN = 1.380649e-23
AIR_VISCOSITY = 1.83e-5  # Pa s at 295 K
MEAN_FREE_PATH_1ATM = 66.0e-9  # m
FRACTAL_PREFACTOR = 1.3
N_BINS = 34


@dataclass(frozen=True)
class AerosolConfig:
    primary_diameter_nm: float = 40.0
    initial_number_cm3: float = 3.0e9
    fractal_dimension: float = 1.8
    residence_time_s: float | None = None  # None: no removal (stagnant microgravity)
    duration_s: float = 600.0
    pressure_atm: float = 1.0
    temperature: float = 295.0
    wavelength_nm: float = 880.0
    n_samples: int = 121


@dataclass
class AerosolResult:
    config: AerosolConfig
    t: np.ndarray
    number_cm3: np.ndarray
    count_mean_diameter_nm: np.ndarray
    mass_mean_diameter_nm: np.ndarray
    mass_fraction_above_1um: np.ndarray
    ionization_signal: np.ndarray  # normalised to t = 0
    photoelectric_signal: np.ndarray  # normalised to t = 0
    ionization_per_mass: np.ndarray
    photoelectric_per_mass: np.ndarray
    mass_retained: np.ndarray
    bin_diameters_nm: np.ndarray
    final_distribution: np.ndarray


def cunningham(diameter: np.ndarray, pressure_atm: float) -> np.ndarray:
    kn = 2.0 * (MEAN_FREE_PATH_1ATM / pressure_atm) / diameter
    return 1.0 + kn * (1.257 + 0.4 * np.exp(-1.1 / kn))


def aggregate_diameters(primary_diameter: float, fractal_dimension: float) -> tuple[np.ndarray, np.ndarray]:
    n = 2.0 ** np.arange(N_BINS)
    d = primary_diameter * np.maximum(n / FRACTAL_PREFACTOR, 1.0) ** (1.0 / fractal_dimension)
    d[0] = primary_diameter
    return n, d


def brownian_kernel(diameters: np.ndarray, pressure_atm: float, temperature: float) -> np.ndarray:
    mobility = cunningham(diameters, pressure_atm) / diameters
    prefactor = 2.0 * K_BOLTZMANN * temperature / (3.0 * AIR_VISCOSITY)
    return prefactor * (diameters[:, None] + diameters[None, :]) * (mobility[:, None] + mobility[None, :])


def _collision_tables() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Pair list (i <= j) with the fixed-pivot split between bins j and j+1.

    For n_k = 2^k the product volume n_i + n_j lies in [n_j, n_{j+1}], and
    the number/mass-conserving weights are 1 - 2^(i-j) and 2^(i-j). Equal
    partners land exactly on bin j+1.
    """
    ii, jj = np.triu_indices(N_BINS)
    ratio = 2.0 ** (ii - jj).astype(float)
    w_upper = np.where(ii == jj, 1.0, ratio)
    w_lower = 1.0 - w_upper
    symmetry = np.where(ii == jj, 0.5, 1.0)
    return ii, jj, w_lower, w_upper, symmetry


def simulate_coagulation(cfg: AerosolConfig = AerosolConfig()) -> AerosolResult:
    d_p = cfg.primary_diameter_nm * 1e-9
    n_prim, d = aggregate_diameters(d_p, cfg.fractal_dimension)
    n0 = cfg.initial_number_cm3 * 1e6
    # Solve in units of N0 so the state stays O(1).
    beta = brownian_kernel(d, cfg.pressure_atm, cfg.temperature) * n0
    ii, jj, w_lower, w_upper, symmetry = _collision_tables()
    beta_pairs = beta[ii, jj] * symmetry
    top = N_BINS - 1
    upper_bin = np.minimum(jj + 1, top)
    # Collisions that would leave the grid are deposited in the top bin with
    # a weight that preserves mass.
    overflow = jj + 1 > top
    w_up = np.where(overflow, (n_prim[ii] + n_prim[jj]) / n_prim[top], w_upper)
    w_lo = np.where(overflow, 0.0, w_lower)
    removal = 0.0 if cfg.residence_time_s is None else 1.0 / cfg.residence_time_s

    # With removal, N_k = z_k exp(-t / tau_res). Solving for the
    # dilution-compensated variable z keeps the size distribution resolved
    # after the absolute concentration has decayed by many decades.
    def rhs(t: float, z: np.ndarray) -> np.ndarray:
        z = np.maximum(z, 0.0)
        rate = beta_pairs * z[ii] * z[jj]
        gain = np.zeros(N_BINS)
        np.add.at(gain, jj, w_lo * rate)
        np.add.at(gain, upper_bin, w_up * rate)
        loss = z * (beta @ z)
        return (gain - loss) * np.exp(-removal * t)

    y0 = np.zeros(N_BINS)
    y0[0] = 1.0
    t_eval = np.linspace(0.0, cfg.duration_s, cfg.n_samples)
    sol = solve_ivp(rhs, (0.0, cfg.duration_s), y0, method="LSODA", t_eval=t_eval, rtol=1e-6, atol=1e-12)
    y = np.maximum(sol.y, 0.0)
    dilution = np.exp(-removal * sol.t)

    number = y.sum(axis=0)
    mass = (n_prim[:, None] * y).sum(axis=0)
    safe_n = np.maximum(number, 1e-300)
    safe_m = np.maximum(mass, 1e-300)
    count_mean = (d[:, None] * y).sum(axis=0) / safe_n
    mass_mean = (d[:, None] * n_prim[:, None] * y).sum(axis=0) / safe_m
    above = d > 1.0e-6
    frac_above = (n_prim[above, None] * y[above]).sum(axis=0) / safe_m

    k_wave = 2.0 * pi / (cfg.wavelength_nm * 1e-9)
    r_g = 0.5 * d
    structure = (1.0 + 4.0 * (k_wave * r_g) ** 2 / (3.0 * cfg.fractal_dimension)) ** (-cfg.fractal_dimension / 2.0)
    c_sca = n_prim**2 * structure
    photo = (c_sca[:, None] * y).sum(axis=0)
    ion = (d[:, None] * y).sum(axis=0)

    return AerosolResult(
        config=cfg,
        t=sol.t,
        number_cm3=number * dilution * cfg.initial_number_cm3,
        count_mean_diameter_nm=count_mean * 1e9,
        mass_mean_diameter_nm=mass_mean * 1e9,
        mass_fraction_above_1um=frac_above,
        ionization_signal=ion * dilution / ion[0],
        photoelectric_signal=photo * dilution / photo[0],
        ionization_per_mass=(ion / safe_m) / (ion[0] / mass[0]),
        photoelectric_per_mass=(photo / safe_m) / (photo[0] / mass[0]),
        mass_retained=mass / mass[0],
        bin_diameters_nm=d * 1e9,
        final_distribution=y[:, -1] * cfg.initial_number_cm3,
    )


def compare_gravity(
    primary_diameter_nm: float = 40.0,
    initial_number_cm3: float = 3.0e9,
    ventilation_cm_s: float = 0.0,
    duration_s: float = 600.0,
    pressure_atm: float = 1.0,
    source_scale_m: float = 0.5,
) -> dict[str, AerosolResult]:
    """Same smoke source aged in a 1-g plume and in a microgravity cabin.

    1-g: buoyant entrainment dilutes the plume with a time constant near 1 s.
    Microgravity: the only removal is forced ventilation sweeping the source
    region, tau = L / U; with the fans off the smoke is not removed at all.
    """
    micro_tau = None if ventilation_cm_s <= 0.0 else source_scale_m / (ventilation_cm_s * 1e-2)
    common = dict(
        primary_diameter_nm=primary_diameter_nm, initial_number_cm3=initial_number_cm3,
        duration_s=duration_s, pressure_atm=pressure_atm,
    )
    return {
        "normal_gravity": simulate_coagulation(AerosolConfig(residence_time_s=1.0, **common)),  # type: ignore[arg-type]
        "microgravity": simulate_coagulation(AerosolConfig(residence_time_s=micro_tau, **common)),  # type: ignore[arg-type]
    }


def monodisperse_halving_time(initial_number_cm3: float, primary_diameter_nm: float, pressure_atm: float = 1.0) -> float:
    """Halving time of a monodisperse aerosol with a constant kernel, 2 / (beta_11 N0)."""
    d = np.array([primary_diameter_nm * 1e-9])
    beta = brownian_kernel(d, pressure_atm, 295.0)[0, 0]
    return 2.0 / (beta * initial_number_cm3 * 1e6)


__all__ = [
    "AerosolConfig", "AerosolResult", "simulate_coagulation", "compare_gravity",
    "brownian_kernel", "cunningham", "aggregate_diameters", "monodisperse_halving_time",
]

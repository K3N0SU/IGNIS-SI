from __future__ import annotations

import numpy as np
import pytest

from physics.aerosol import (
    AerosolConfig,
    aggregate_diameters,
    brownian_kernel,
    compare_gravity,
    cunningham,
    monodisperse_halving_time,
    simulate_coagulation,
)


def test_kernel_is_symmetric_and_positive() -> None:
    _, d = aggregate_diameters(40e-9, 1.8)
    beta = brownian_kernel(d, 1.0, 295.0)
    assert np.allclose(beta, beta.T) and np.all(beta > 0.0)


def test_slip_correction_limits() -> None:
    c = cunningham(np.array([10e-9, 10e-6]), 1.0)
    assert c[0] > 10.0 and c[1] == pytest.approx(1.0, abs=0.03)


def test_mass_is_conserved() -> None:
    r = simulate_coagulation(AerosolConfig(duration_s=600.0))
    assert np.allclose(r.mass_retained, 1.0, atol=1e-6)


def test_number_decays_at_smoluchowski_rate() -> None:
    cfg = AerosolConfig(initial_number_cm3=1.0e9, duration_s=20.0, n_samples=201)
    r = simulate_coagulation(cfg)
    t_half = monodisperse_halving_time(cfg.initial_number_cm3, cfg.primary_diameter_nm)
    measured = float(np.interp(0.5, r.number_cm3[::-1] / cfg.initial_number_cm3, r.t[::-1]))
    # The slip correction falls as aggregates grow, so the kernel weakens
    # and halving takes slightly longer than the constant-kernel estimate.
    assert 0.9 * t_half < measured < 1.4 * t_half


def test_microgravity_grows_micron_aggregates_normal_gravity_does_not() -> None:
    runs = compare_gravity()
    micro, normal = runs["microgravity"], runs["normal_gravity"]
    assert micro.count_mean_diameter_nm[-1] > 1000.0
    assert micro.mass_fraction_above_1um[-1] > 0.5
    assert normal.count_mean_diameter_nm[-1] < 200.0
    assert normal.mass_fraction_above_1um[-1] < 1e-3


def test_detector_response_trends() -> None:
    micro = compare_gravity()["microgravity"]
    # Ionization response per unit smoke mass collapses with aggregate growth.
    assert micro.ionization_per_mass[-1] < 0.1
    # Scattering per unit mass rises, then saturates in the RDG power-law regime.
    late = micro.photoelectric_per_mass
    assert late[-1] > 10.0
    assert abs(late[-1] - late[-20]) / late[-1] < 0.05


def test_ventilation_limits_growth() -> None:
    still = compare_gravity(ventilation_cm_s=0.0)["microgravity"]
    vented = compare_gravity(ventilation_cm_s=10.0)["microgravity"]
    assert vented.count_mean_diameter_nm[-1] < still.count_mean_diameter_nm[-1]

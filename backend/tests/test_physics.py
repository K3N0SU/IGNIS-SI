from __future__ import annotations

from math import log

import numpy as np
import pytest

from data.nasa_psi_corpus import BENCHMARKS
from physics.damkohler import ExtinctionMode, classify_extinction, damkohler_hot, flow_time
from physics.droplet import (
    adiabatic_flame_temperature,
    classical_burning_rate,
    cool_flame_temperature,
    hot_flame_state,
)
from physics.eclss import generate_protocol, limiting_oxygen, limiting_pressure
from physics.low_flow import critical_reignition_airflow, flow_response
from physics.properties import DEFAULT_CALIBRATION, FUELS, Ambient
from physics.solver import SimulationConfig, SimulationResult, simulate
from physics.transport import film_conductivity, frossling_factor

AIR = Ambient(0.21, 1.0)
BENCH = {b.key: b for b in BENCHMARKS}


class TestD2Law:
    def test_burning_rate_matches_closed_form(self) -> None:
        fuel = FUELS["n-heptane"]
        t_f = adiabatic_flame_temperature(fuel, AIR)
        t_film = 0.5 * (t_f + fuel.t_boil)
        cp = fuel.vapor_cp(t_film)
        b = (cp * (AIR.temperature - fuel.t_boil) + AIR.y_o2 * fuel.heat_of_combustion / fuel.stoich_o2_mass) / fuel.h_fg
        expected = 8.0 * film_conductivity(fuel, AIR, t_film) / (fuel.rho_liquid * cp) * log(1.0 + b)
        assert classical_burning_rate(fuel, AIR) == pytest.approx(expected, rel=1e-12)

    def test_no_oxidizer_reduces_to_vaporisation_limit(self) -> None:
        # With T_inf below the boiling point and no oxygen, B <= 0 and K = 0.
        assert classical_burning_rate(FUELS["n-heptane"], Ambient(1e-9, 1.0)) == 0.0

    def test_d_squared_is_linear_for_small_droplet(self) -> None:
        r = simulate(SimulationConfig(d0_mm=1.5))
        hot = np.array([x == "HOT_FLAME" for x in r.regime])
        t, d2 = r.t[hot][10:-10], r.series["d2_mm2"][hot][10:-10]
        slope, intercept = np.polyfit(t, d2, 1)
        residual = d2 - (slope * t + intercept)
        assert np.abs(residual).max() < 0.03 * d2.max()
        assert -slope == pytest.approx(float(r.summary["mean_hot_burning_rate_mm2_s"]), rel=0.1)

    def test_diameter_never_increases(self, baseline: SimulationResult) -> None:
        assert np.all(np.diff(baseline.series["d_mm"]) <= 1e-9)

    @pytest.mark.parametrize("fuel,bench", [("n-heptane", "heptane_hot_k"), ("methanol", "methanol_hot_k")])
    def test_hot_burning_rate_within_published_range(self, fuel: str, bench: str) -> None:
        r = simulate(SimulationConfig(fuel=fuel, d0_mm=2.0))  # type: ignore[arg-type]
        k = float(r.summary["mean_hot_burning_rate_mm2_s"])
        assert BENCH[bench].low * 0.9 <= k <= BENCH[bench].high

    def test_burning_rate_rises_with_oxygen(self) -> None:
        fuel = FUELS["n-heptane"]
        rates = [classical_burning_rate(fuel, Ambient(x, 1.0)) for x in (0.15, 0.21, 0.30, 0.40)]
        assert rates == sorted(rates)


class TestRadiation:
    def test_radiative_loss_scales_with_flame_volume(self) -> None:
        fuel = FUELS["n-heptane"]
        small = hot_flame_state(fuel, AIR, 1.0e-3, 6.0, 0.0)
        large = hot_flame_state(fuel, AIR, 2.0e-3, 6.0, 0.0)
        # Q_rad ~ D^3 T^4 and Q_gen ~ D, so chi_r grows faster than D.
        assert large.radiative_fraction > 2.0 * small.radiative_fraction
        assert large.flame_temperature < small.flame_temperature

    def test_flame_temperature_bounded_by_adiabatic(self) -> None:
        fuel = FUELS["n-heptane"]
        state = hot_flame_state(fuel, AIR, 3.0e-3, 5.0, 0.0)
        assert AIR.temperature < state.flame_temperature < adiabatic_flame_temperature(fuel, AIR)


class TestExtinction:
    def test_small_droplet_burns_to_completion(self) -> None:
        r = simulate(SimulationConfig(d0_mm=2.0))
        assert not r.summary["cool_flame_present"]
        assert r.summary["final_regime"] == "BURNOUT"
        assert float(r.summary["fuel_consumed_fraction"]) > 0.99

    def test_large_droplet_radiative_extinction_then_cool_flame(self, baseline: SimulationResult) -> None:
        kinds = [e.kind for e in baseline.events]
        assert kinds.index("HOT_FLAME_EXTINCTION_RADIATIVE") < kinds.index("COOL_FLAME_ONSET") < kinds.index("COOL_FLAME_EXTINCTION")
        assert baseline.summary["extinction_mode"] == ExtinctionMode.RADIATIVE.value

    def test_radiative_extinction_threshold_diameter(self) -> None:
        sizes = [round(2.8 + 0.1 * i, 1) for i in range(13)]
        onset = next(d for d in sizes if simulate(SimulationConfig(d0_mm=d)).summary["cool_flame_present"])
        # Flight brackets the transition between the largest droplet that burned
        # out and the smallest that lost its flame; allow 0.3 mm either side.
        assert BENCH["heptane_rad_ext_d0"].low - 0.3 <= onset <= BENCH["heptane_rad_ext_d0"].high + 0.3

    def test_cool_flame_benchmarks(self, baseline: SimulationResult) -> None:
        k_cool = float(baseline.summary["mean_cool_burning_rate_mm2_s"])
        d_ext = float(baseline.summary["final_diameter_mm"])
        assert BENCH["heptane_cool_k"].low <= k_cool <= BENCH["heptane_cool_k"].high
        assert BENCH["heptane_cool_ext_d"].low <= d_ext <= BENCH["heptane_cool_ext_d"].high
        assert k_cool < float(baseline.summary["mean_hot_burning_rate_mm2_s"])

    def test_cool_flame_is_optically_dark_but_uv_visible(self, baseline: SimulationResult) -> None:
        cool = np.array([x == "INVISIBLE_COOL_FLAME" for x in baseline.regime])
        settled = cool & (baseline.t > float(baseline.summary["first_extinction_s"]) + 3.0)
        assert baseline.series["visible_luminosity"][settled].max() < 1e-4
        assert baseline.series["uv_intensity"][settled].min() > 1e-4
        assert baseline.series["co_o2_ratio"][settled].min() > 0.2

    def test_methanol_has_no_cool_flame(self) -> None:
        assert not simulate(SimulationConfig(fuel="methanol", d0_mm=4.5)).summary["cool_flame_present"]

    def test_high_strain_blowoff(self) -> None:
        r = simulate(SimulationConfig(d0_mm=3.9, airflow_cm_s=60.0, t_max_s=40.0))
        assert r.summary["extinction_mode"] == ExtinctionMode.BLOWOFF.value

    def test_flow_time_decreases_with_strain(self) -> None:
        assert flow_time(0.02, 2e-4, 0.5) < flow_time(0.02, 2e-4, 0.05) < flow_time(0.02, 2e-4, 0.0)

    def test_extinction_attribution(self) -> None:
        fuel = FUELS["n-heptane"]
        radiating = hot_flame_state(fuel, AIR, 3.9e-3, 7.0, 0.0)
        strained = hot_flame_state(fuel, AIR, 3.9e-3, 2.5, 1.5)
        assert classify_extinction(radiating, 0.0, 0.9) is ExtinctionMode.RADIATIVE
        assert classify_extinction(strained, 1.5, 0.9) is ExtinctionMode.BLOWOFF
        assert damkohler_hot(strained, AIR, 1.5) < damkohler_hot(hot_flame_state(fuel, AIR, 3.9e-3, 2.5, 0.0), AIR, 0.0)


class TestLowFlow:
    def test_response_is_non_monotonic(self) -> None:
        pts = flow_response("n-heptane", AIR, 3.0e-3, [0.0, 10.0, 20.0, 40.0, 400.0])
        q = [p.heat_release_w for p in pts]
        assert q[1] > 5.0 * q[0]
        assert q[1] < q[2] < q[3]
        assert q[4] == 0.0

    def test_frossling_limits(self) -> None:
        assert frossling_factor(0.0) == 1.0
        assert frossling_factor(4.0) > frossling_factor(1.0) > 1.0
        # Stefan-flow blowing thickens the film and weakens the enhancement.
        assert frossling_factor(4.0, 8.0) < frossling_factor(4.0)

    def test_airflow_raises_cool_flame_temperature(self) -> None:
        temps = [cool_flame_temperature(AIR, 2.5e-3, u) for u in (0.0, 0.02, 0.05, 0.10)]
        assert temps == sorted(temps) and temps[0] == pytest.approx(DEFAULT_CALIBRATION.t_cool_base, abs=1.0)

    def test_ventilation_restart_reignites(self, backfire: SimulationResult) -> None:
        kinds = [e.kind for e in backfire.events]
        assert kinds.index("COOL_FLAME_ONSET") < kinds.index("VENTILATION_RESTORED") < kinds.index("HOT_REIGNITION")
        assert backfire.summary["reignition_count"] == 1

    def test_weak_ventilation_does_not_reignite(self) -> None:
        r = simulate(SimulationConfig(airflow_cm_s=2.0, flow_mode="RESTORE_AFTER_EXTINCTION"))
        assert r.summary["reignition_count"] == 0
        assert "RE_IGNITION_RISK" in r.regime

    def test_critical_airflow_separates_outcomes(self) -> None:
        u_crit = critical_reignition_airflow("n-heptane", AIR, 3.5e-3)
        assert u_crit is not None and 1.0 < u_crit < 10.0


class TestEclss:
    def test_limits_bracket_current_atmosphere(self) -> None:
        x_lim = limiting_oxygen("n-heptane", 1.0, 3.5e-3, "N2")
        p_lim = limiting_pressure("n-heptane", 0.21, 3.5e-3, "N2")
        assert x_lim is not None and 0.05 < x_lim < 0.21
        assert p_lim is not None and 0.1 < p_lim < 1.0

    def test_protocol_flags_hidden_cool_flame(self, baseline: SimulationResult) -> None:
        protocol = generate_protocol(baseline.config, baseline)
        assert protocol.hazard_level == "CRITICAL"
        codes = [s.code for s in protocol.steps]
        assert codes == ["DETECT", "VENT_CUTOFF", "DILUENT_INJECTION", "DEPRESSURIZATION", "ATMOSPHERE_RECOVERY"]
        vent = protocol.steps[1]
        assert vent.status == "HOLD" and vent.parameters["critical_reignition_airflow_cm_s"] is not None

    def test_protocol_reports_reignition(self, backfire: SimulationResult) -> None:
        protocol = generate_protocol(backfire.config, backfire)
        assert "re-ignited" in protocol.headline

    def test_non_flammable_atmosphere_is_nominal(self) -> None:
        cfg = SimulationConfig(x_o2=0.10, pressure_atm=0.4)
        assert generate_protocol(cfg, simulate(cfg)).hazard_level == "NOMINAL"

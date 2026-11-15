from __future__ import annotations

import numpy as np
import pytest

from data.generate_dataset import sample_scenarios
from data.nasa_psi_corpus import CITATIONS, DROPLET_CAMPAIGNS, ENVELOPE_DIMENSIONS, EXPERIMENTS, provenance
from ml import risk_ranker
from ml.features import FEATURE_NAMES, LABELS, SensorNoise, build_features, label_index
from ml.regime_classifier import load_metrics
from ml.train import ensure_trained
from ml.uncertainty import assess, calibration_ensemble, envelope_check
from physics.solver import SimulationConfig, SimulationResult


class TestCorpus:
    def test_required_campaigns_present(self) -> None:
        assert {"FLEX", "FLEX-2", "CFI", "BASS-II", "SAFFIRE-I-III", "SAFFIRE-IV-VI", "SAME"} <= set(EXPERIMENTS)

    def test_every_citation_resolves(self) -> None:
        for exp in EXPERIMENTS.values():
            assert exp.citations and all(c in CITATIONS for c in exp.citations)

    def test_droplet_envelopes_are_complete_and_ordered(self) -> None:
        for key in DROPLET_CAMPAIGNS:
            env = EXPERIMENTS[key].envelope
            assert all(d in env and env[d].low <= env[d].high for d in ENVELOPE_DIMENSIONS)

    def test_provenance_marks_model_output(self) -> None:
        meta = provenance("n-heptane", 3.9, 0.21, 1.0, 0.0)
        assert meta["source"] == "model" and meta["reference_experiment"] == "FLEX"
        assert all(meta["within_reference_envelope"].values())  # type: ignore[union-attr]


class TestFeatures:
    def test_feature_matrix_shape(self, baseline: SimulationResult) -> None:
        s = baseline.series
        x = build_features(baseline.t, s["radiometer_w_m2"], s["uv_intensity"], s["co_o2_ratio"])
        assert x.shape == (len(baseline.t), len(FEATURE_NAMES)) and np.isfinite(x).all()

    def test_noise_is_non_negative_and_reproducible(self) -> None:
        signal = np.linspace(0.0, 5.0, 50)
        a = SensorNoise().apply(signal, "radiometer", np.random.default_rng(3))
        b = SensorNoise().apply(signal, "radiometer", np.random.default_rng(3))
        assert np.array_equal(a, b) and a.min() >= 0.0

    def test_label_mapping(self) -> None:
        assert LABELS[label_index("BURNOUT")] == LABELS[label_index("EXTINGUISHED")] == "NO_COMBUSTION"

    def test_scenario_sampler_is_deterministic(self) -> None:
        assert sample_scenarios(12, 5) == sample_scenarios(12, 5)


class TestClassifier:
    def test_held_out_accuracy(self) -> None:
        ensure_trained()
        metrics = load_metrics()
        assert metrics is not None
        assert float(metrics["accuracy"]) > 0.93  # type: ignore[arg-type]
        assert float(metrics["per_class"]["INVISIBLE_COOL_FLAME"]["recall"]) > 0.95  # type: ignore[index]

    def test_detects_cool_flame_without_optical_input(self, baseline: SimulationResult) -> None:
        out = ensure_trained().predict_simulated(baseline.t, baseline.series, seed=42)
        truth = np.array([r == "INVISIBLE_COOL_FLAME" for r in baseline.regime])
        predicted = np.array([p == "INVISIBLE_COOL_FLAME" for p in out.labels])
        assert (predicted & truth).sum() / truth.sum() > 0.95
        assert baseline.series["visible_luminosity"][truth].max() < 1e-2

    def test_probabilities_are_normalised(self, backfire: SimulationResult) -> None:
        out = ensure_trained().predict_simulated(backfire.t, backfire.series)
        assert np.allclose(out.probabilities.sum(axis=1), 1.0, atol=1e-6)
        assert "HOT_FLAME" in out.labels and "INVISIBLE_COOL_FLAME" in out.labels


class TestRiskRanker:
    def test_scores_bounded_and_sorted(self) -> None:
        entries = risk_ranker.rank()
        assert len(entries) == len(risk_ranker.MATERIALS) * len(risk_ranker.ATMOSPHERES)
        composites = [e.composite for e in entries]
        assert composites == sorted(composites, reverse=True)
        for e in entries:
            assert all(0.0 <= v <= 100.0 for v in (e.ignition_propensity, e.toxic_co_yield, e.suppression_difficulty, e.composite))

    @pytest.mark.parametrize("material", list(risk_ranker.MATERIALS))
    def test_artemis_atmosphere_is_never_safer_than_iss(self, material: str) -> None:
        by_atm = {e.atmosphere: e for e in risk_ranker.rank() if e.material == material}
        assert by_atm["ARTEMIS"].ignition_propensity >= by_atm["ISS"].ignition_propensity
        assert by_atm["ARTEMIS"].composite >= by_atm["ISS"].composite

    def test_nomex_becomes_flammable_only_in_enriched_atmosphere(self) -> None:
        by_atm = {e.atmosphere: e for e in risk_ranker.rank() if e.material == "NOMEX"}
        assert by_atm["ISS"].oxygen_margin_pct < 0.0 < by_atm["ARTEMIS"].oxygen_margin_pct

    def test_weights_change_ordering_metric(self) -> None:
        tox = risk_ranker.rank({"ignition": 0.0, "toxicity": 1.0, "suppression": 0.0})
        assert tox[0].composite == pytest.approx(tox[0].toxic_co_yield, abs=0.06)


class TestUncertainty:
    def test_flex_condition_is_verified(self) -> None:
        verdict, distance, _, _ = envelope_check(SimulationConfig())
        assert verdict == "VERIFIED" and distance == 0.0

    def test_ventilated_condition_is_beyond_frontier(self) -> None:
        a = assess(SimulationConfig(airflow_cm_s=8.0, flow_mode="RESTORE_AFTER_EXTINCTION"), ensemble_size=6)
        assert a.verdict == "BEYOND_FRONTIER" and a.frontier_distance > 1.0
        assert any(d.dimension == "airflow_cm_s" and not d.inside for d in a.dimensions)
        assert a.outcome_distribution is not None and sum(a.outcome_distribution.values()) == pytest.approx(1.0)

    def test_untested_fuel_combination_is_interpolated(self) -> None:
        verdict, _, _, _ = envelope_check(SimulationConfig(fuel="methanol", airflow_cm_s=2.0))
        assert verdict == "INTERPOLATED"

    def test_ensemble_is_reproducible_and_bounded(self) -> None:
        a, b = calibration_ensemble(8), calibration_ensemble(8)
        assert a == b and len(a) == 8
        d = assess(SimulationConfig(d0_mm=2.0), ensemble_size=6).model_disagreement
        assert d is not None and 0.0 <= d <= 1.0

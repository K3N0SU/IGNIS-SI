from __future__ import annotations

import hashlib
import json
import re
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app import assistant
from data import psi_flight
from data.calibrate import split
from data.nasa_psi_corpus import BENCHMARKS, CITATIONS, EXPERIMENTS, datasets, provenance
from data.validation import compare, config_for, metrics
from ml.uncertainty import assess, nearest_flight_tests
from physics.droplet import liquid_water_fraction
from physics.properties import FUELS, Ambient
from physics.solver import SimulationConfig, simulate

DOI = re.compile(r"^10\.\d{4,9}/\S+$")
QUERY = {
    "fuel": "n-heptane", "d0_mm": 3.9, "x_o2": 0.21, "pressure_atm": 1.0, "airflow_cm_s": 0.0,
    "flow_mode": "RESTORE_AFTER_EXTINCTION", "restore_delay_s": 6.0, "diluent": "N2",
}


class TestPsiFiles:
    def test_every_file_matches_its_recorded_checksum(self) -> None:
        for entry in psi_flight.manifest()["investigations"].values():  # type: ignore[union-attr]
            assert entry["tables"], entry["key"]
            for table in entry["tables"]:
                raw = (psi_flight.PSI_DIR / table["file"]).read_bytes()
                assert hashlib.sha256(raw).hexdigest() == table["sha256"]
                assert table["url"].startswith("https://psi.nasa.gov/")

    def test_all_investigations_carry_nasa_doi_and_open_license(self) -> None:
        listed = datasets()
        assert {d["key"] for d in listed} >= {"FLEX", "FLEX-2", "CFI", "BASS-II", "SAFFIRE-I", "SAME"}
        for d in listed:
            assert DOI.match(str(d["doi"])) and d["license"] == "CC0-1.0"


class TestFlexTable:
    def test_row_counts(self) -> None:
        tests = psi_flight.load_flex()
        assert len(tests) == 274
        usable = [t for t in tests if t.usable]
        assert len(usable) > 250
        assert {t.fuel for t in usable} == {"n-heptane", "methanol"}

    def test_units_and_composition(self) -> None:
        for t in psi_flight.load_flex():
            if not t.usable:
                continue
            assert 0.5 < t.pressure_atm < 3.5
            assert t.x_o2 + t.x_n2 + t.x_co2 + t.x_he == pytest.approx(1.0, abs=0.03)
            if t.burning_rate_mm2_s is not None:
                assert 0.0 < t.burning_rate_mm2_s < 1.5

    def test_known_test_point(self) -> None:
        test = next(t for t in psi_flight.load_flex() if t.identifier == "181F001")
        assert test.fuel == "n-heptane" and test.d0_mm == pytest.approx(3.85)
        assert test.burning_rate_mm2_s == pytest.approx(0.43)
        assert test.extinction_diameter_mm / test.d0_mm == pytest.approx(0.868, abs=0.005)  # type: ignore[operator]

    def test_other_tables_parse(self) -> None:
        assert len(psi_flight.load_cfi()) > 80
        assert any(s.material.lower().startswith("silicone") for s in psi_flight.load_saffire())
        assert {r.material for r in psi_flight.load_same_r()} >= {"Kapton", "Teflon"}


class TestCorpus:
    def test_every_citation_has_a_doi(self) -> None:
        for c in CITATIONS.values():
            assert DOI.match(c.doi), c.key
            assert c.url == f"https://doi.org/{c.doi}"

    def test_envelopes_come_from_the_flight_table(self) -> None:
        env = EXPERIMENTS["FLEX"].envelope
        assert env["d0_mm"].confidence == "flight_table"
        usable = [t for t in psi_flight.load_flex() if t.usable]
        assert env["x_o2"].low == pytest.approx(min(t.x_o2 for t in usable))
        assert EXPERIMENTS["FLEX-2"].envelope["airflow_cm_s"].high == 5.0

    def test_benchmarks_are_measured(self) -> None:
        by_key = {b.key: b for b in BENCHMARKS}
        assert by_key["heptane_hot_k"].confidence == "flight_table" and by_key["heptane_hot_k"].n_tests >= 10
        assert 3.0 < by_key["heptane_rad_ext_d0"].low < by_key["heptane_rad_ext_d0"].high < 3.8

    def test_provenance_links_dataset(self) -> None:
        meta = provenance("n-heptane", 3.9, 0.21, 1.0, 0.0)
        assert meta["accession"] == "PSI-69" and meta["dataset_doi"] == "10.60555/mbq8-0451"
        assert all(DOI.match(c["doi"]) for c in meta["citations"])  # type: ignore[index, union-attr]


class TestBlendsAndWater:
    def test_blend_reduces_to_single_diluent(self) -> None:
        pure = Ambient(0.21, 1.0, diluent="CO2")
        blend = Ambient(0.21, 1.0, x_co2=0.79, x_he=0.0)
        assert blend.molar_mass == pytest.approx(pure.molar_mass)
        assert blend.cp == pytest.approx(pure.cp)

    def test_blend_fractions_sum_to_one(self) -> None:
        fractions = Ambient(0.18, 1.0, x_co2=0.2, x_he=0.1).diluent_fractions
        assert sum(fractions.values()) == pytest.approx(1.0)
        assert fractions["CO2"] == pytest.approx(0.2 / 0.82)

    def test_only_methanol_absorbs_water(self) -> None:
        assert liquid_water_fraction(FUELS["n-heptane"], 0.5) == 0.0
        fractions = [liquid_water_fraction(FUELS["methanol"], r) for r in (1.0, 0.9, 0.8, 0.7)]
        assert fractions[0] == 0.0 and fractions == sorted(fractions)

    def test_methanol_extinguishes_at_finite_diameter(self) -> None:
        r = simulate(SimulationConfig(fuel="methanol", d0_mm=2.6))
        assert any(e.kind == "HOT_FLAME_EXTINCTION_WATER" for e in r.events)
        assert 0.2 < float(r.summary["final_diameter_mm"]) / 2.6 < 0.9


class TestValidation:
    def test_split_is_disjoint_and_complete(self) -> None:
        train, holdout = split(psi_flight.load_flex())
        ids = {t.test_number for t in train} | {t.test_number for t in holdout}
        assert not {t.test_number for t in train} & {t.test_number for t in holdout}
        assert len(ids) == len([t for t in psi_flight.load_flex() if t.usable])
        assert 0.2 < len(holdout) / len(ids) < 0.3

    def test_compare_reproduces_reference_test(self) -> None:
        test = next(t for t in psi_flight.load_flex() if t.identifier == "181F001")
        assert config_for(test).d0_mm == test.d0_mm
        row = compare(test)
        assert row.model_ignited and row.early_extinction_flight is True and row.early_extinction_model is True
        assert row.k_model == pytest.approx(row.k_flight, abs=0.12)
        assert row.ext_ratio_model == pytest.approx(row.ext_ratio_flight, abs=0.12)

    def test_metrics_shape(self) -> None:
        rows = [compare(t) for t in psi_flight.load_flex()[:12] if t.usable]
        m = metrics(rows)
        assert m["tests_compared"] == len(rows) and "burning_rate_mm2_s" in m["all"]  # type: ignore[operator]


class TestNearestTests:
    def test_nearest_is_same_fuel_and_sorted(self) -> None:
        found = nearest_flight_tests(SimulationConfig(), k=5)
        assert len(found) == 5 and found[0]["identifier"] == "181F001" and found[0]["same_fuel"]
        distances = [float(t["distance"]) for t in found]  # type: ignore[arg-type]
        assert distances == sorted(distances)

    def test_assessment_carries_neighbours(self) -> None:
        a = assess(SimulationConfig(), ensemble_size=0)
        assert a.nearest_tests and a.nearest_distance is not None and a.nearest_distance < 0.5

    def test_untested_fuel_is_penalised(self) -> None:
        found = nearest_flight_tests(SimulationConfig(fuel="n-dodecane"))
        assert not found[0]["same_fuel"] and float(found[0]["distance"]) >= 3.0  # type: ignore[arg-type]


class _FakeClient:
    """Stands in for httpx.Client: first reply calls two tools, second answers."""

    calls: list[dict[str, Any]] = []

    def __init__(self, *_: Any, **__: Any) -> None:
        pass

    def __enter__(self) -> "_FakeClient":
        return self

    def __exit__(self, *_: Any) -> None:
        return None

    def post(self, url: str, headers: dict[str, str], json: dict[str, Any]) -> httpx.Response:
        _FakeClient.calls.append({"url": url, "headers": headers, "body": json})
        if len(_FakeClient.calls) == 1:
            parts = [
                {"functionCall": {"name": "run_simulation", "args": {"airflow_cm_s": 8}}},
                {"functionCall": {"name": "apply_scenario", "args": {"airflow_cm_s": 8, "sensor_view": "uv", "reason": "Fan restart"}}},
            ]
        else:
            parts = [{"text": "Restarting the fans re-ignites the hot flame."}]
        return httpx.Response(200, json={"candidates": [{"content": {"role": "model", "parts": parts}}]})


class TestAssistant:
    def test_scenario_arguments_are_clamped(self) -> None:
        q = assistant.scenario_from_args({"o2_percent": 90, "d0_mm": 0.1, "airflow_cm_s": 8, "fuel": "kerosene"}, QUERY)
        assert q["x_o2"] == 0.30 and q["d0_mm"] == 1.5 and q["airflow_cm_s"] == 8.0 and q["fuel"] == "n-heptane"

    def test_tools_return_grounded_results(self) -> None:
        sim = assistant.tool_run_simulation({**QUERY, "airflow_cm_s": 8.0})
        assert sim["summary"]["reignition_count"] >= 1 and "model" in sim["source"]
        evidence = assistant.tool_flight_evidence(QUERY)
        assert evidence["nearest_flight_tests"][0]["identifier"] == "181F001"
        assert evidence["dataset_doi"] == "10.60555/mbq8-0451"

    def test_agent_loop_executes_tools_and_returns_actions(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _FakeClient.calls = []
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        monkeypatch.setattr(assistant.httpx, "Client", _FakeClient)
        out = assistant.chat([{"role": "user", "content": "Is it safe to restart the fans?"}], dict(QUERY), {})
        assert out["reply"].startswith("Restarting")
        assert [c["name"] for c in out["tool_calls"]] == ["run_simulation", "apply_scenario"]
        action = out["actions"][0]
        assert action["query"]["airflow_cm_s"] == 8.0 and action["sensor_view"] == "uv"
        assert len(_FakeClient.calls) == 2
        second = json.dumps(_FakeClient.calls[1]["body"])
        assert "functionResponse" in second and "test-key" not in second
        assert _FakeClient.calls[0]["headers"]["x-goog-api-key"] == "test-key"

    def test_missing_key_is_reported_not_raised_as_500(self, monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.setattr(assistant, "_read_env_file", lambda: {})
        assert client.get("/api/assistant/status").json()["configured"] is False
        r = client.post("/api/assistant", json={"messages": [{"role": "user", "content": "hello"}], "query": QUERY})
        assert r.status_code == 503 and "GEMINI_API_KEY" in r.json()["detail"]


class TestFlightEndpoints:
    def test_datasets(self, client: TestClient) -> None:
        body = client.get("/api/flight/datasets").json()
        assert len(body["datasets"]) == 11 and sum(d["rows"] for d in body["datasets"]) > 1000

    def test_flex_validation(self, client: TestClient) -> None:
        body = client.get("/api/flight/flex").json()
        assert body["dataset_doi"] == "10.60555/mbq8-0451" and len(body["tests"]) > 250
        assert body["metrics"]["all"]["burning_rate_mm2_s"]["n"] > 150

    def test_saffire(self, client: TestClient) -> None:
        assert len(client.get("/api/flight/saffire").json()["samples"]) >= 10

    def test_uncertainty_returns_neighbours(self, client: TestClient) -> None:
        body = client.post("/api/uncertainty?ensemble=0", json={}).json()
        assert body["nearest_tests"][0]["identifier"] == "181F001"


class TestInvestigations:
    def test_ranking_for_droplet_scenario(self) -> None:
        from data.investigations import Scenario, compare

        rows = compare(Scenario("n-heptane", 3.9, 0.21, 1.0, 0.0))
        assert [r["rank"] for r in rows] == list(range(1, len(rows) + 1))
        assert rows[0]["key"] == "FLEX" and rows[0]["coverage"] == 1.0
        scores = [float(r["relevance"]) for r in rows]
        assert scores == sorted(scores, reverse=True) and all(0.0 <= v <= 100.0 for v in scores)
        for r in rows:
            assert r["diagnostics"] and r["summary"] and r["why"]

    def test_airflow_outside_flex_is_explained(self) -> None:
        from data.investigations import Scenario, compare

        rows = {r["key"]: r for r in compare(Scenario("n-heptane", 3.9, 0.21, 1.0, 8.0))}
        assert "airflow" in rows["FLEX"]["why"] and rows["FLEX"]["coverage"] < 1.0
        assert rows["BASS-II"]["coverage"] >= rows["FLEX"]["coverage"]

    def test_endpoint(self, client: TestClient) -> None:
        body = client.post("/api/investigations", json={}).json()
        first = body["investigations"][0]
        assert first["key"] == "FLEX" and first["dataset_dois"] == ["10.60555/mbq8-0451"]
        assert first["oxygen"]["source"] == "flight_table"

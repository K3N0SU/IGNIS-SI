from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["classifier_loaded"] is True


def test_simulate_default_is_flex_cool_flame_case(client: TestClient) -> None:
    r = client.post("/api/simulate", json={})
    assert r.status_code == 200
    body = r.json()
    n = len(body["t"])
    assert n > 100 and len(body["regime"]) == n
    assert all(len(v) == n for v in body["series"].values())
    assert len(body["classifier"]["labels"]) == n and body["classifier"]["agreement"] > 0.9
    assert body["summary"]["cool_flame_present"] is True
    assert body["provenance"]["source"] == "model"
    assert body["protocol"]["hazard_level"] == "CRITICAL"


def test_simulate_ventilation_backfire(client: TestClient) -> None:
    body = client.post(
        "/api/simulate", json={"airflow_cm_s": 8.0, "flow_mode": "RESTORE_AFTER_EXTINCTION"}
    ).json()
    assert body["summary"]["reignition_count"] >= 1
    assert any(e["kind"] == "HOT_REIGNITION" for e in body["events"])
    assert body["provenance"]["within_reference_envelope"]["airflow_cm_s"] is False


@pytest.mark.parametrize(
    "payload",
    [{"x_o2": 0.9}, {"pressure_atm": 0.0}, {"fuel": "kerosene"}, {"d0_mm": -1.0}, {"flow_mode": "PULSED"}],
)
def test_simulate_rejects_out_of_range_input(client: TestClient, payload: dict[str, object]) -> None:
    assert client.post("/api/simulate", json=payload).status_code == 422


def test_classify_round_trip(client: TestClient) -> None:
    sim = client.post("/api/simulate", json={}).json()
    frame = {k: sim["series"][k] for k in ("radiometer_w_m2", "uv_intensity", "co_o2_ratio")}
    r = client.post("/api/classify", json={"t": sim["t"], **frame})
    assert r.status_code == 200
    body = r.json()
    assert len(body["labels"]) == len(sim["t"]) and "INVISIBLE_COOL_FLAME" in body["labels"]
    assert len(body["probabilities"][0]) == len(body["label_order"])


def test_classify_rejects_mismatched_lengths(client: TestClient) -> None:
    r = client.post("/api/classify", json={"t": [0, 1, 2], "radiometer_w_m2": [1, 1], "uv_intensity": [1, 1, 1], "co_o2_ratio": [0, 0, 0]})
    assert r.status_code == 422


def test_eclss(client: TestClient) -> None:
    body = client.post("/api/eclss", json={}).json()
    assert [s["order"] for s in body["steps"]] == [1, 2, 3, 4, 5]


def test_uncertainty(client: TestClient) -> None:
    inside = client.post("/api/uncertainty?ensemble=4", json={}).json()
    outside = client.post("/api/uncertainty?ensemble=4", json={"airflow_cm_s": 12.0}).json()
    assert inside["verdict"] == "VERIFIED" and outside["verdict"] == "BEYOND_FRONTIER"
    assert client.post("/api/uncertainty?ensemble=99", json={}).status_code == 422


def test_frontier_grid(client: TestClient) -> None:
    body = client.post("/api/frontier", json={}).json()
    assert len(body["verdict"]) == len(body["airflow_cm_s"])
    assert len(body["verdict"][0]) == len(body["o2"])
    assert body["verdict"][0][11] == "VERIFIED" and body["verdict"][-1][11] == "BEYOND_FRONTIER"


def test_flow_sweep(client: TestClient) -> None:
    pts = client.post("/api/flow-sweep", json={"points": 30}).json()["points"]
    assert len(pts) == 30 and pts[0]["airflow_cm_s"] == 0.0
    assert max(p["heat_release_w"] for p in pts) > 10.0 * pts[0]["heat_release_w"]


def test_aerosol(client: TestClient) -> None:
    body = client.post("/api/aerosol", json={}).json()
    assert body["microgravity"]["final_count_mean_diameter_nm"] > 1000.0
    assert body["normal_gravity"]["final_count_mean_diameter_nm"] < 200.0


def test_risk_leaderboard(client: TestClient) -> None:
    default = client.get("/api/risk").json()
    assert len(default["entries"]) == 18 and default["entries"][0]["rank"] == 1
    weighted = client.post("/api/risk", json={"ignition": 1.0, "toxicity": 0.0, "suppression": 0.0}).json()
    assert weighted["entries"][0]["composite"] == pytest.approx(weighted["entries"][0]["ignition_propensity"], abs=0.06)


def test_corpus_and_model_card(client: TestClient) -> None:
    corpus = client.get("/api/corpus").json()
    assert {e["key"] for e in corpus["experiments"]} >= {"FLEX", "CFI", "BASS-II", "SAME"}
    assert "not flight data" in corpus["disclaimer"]
    assert client.get("/api/model-card").json()["accuracy"] > 0.9

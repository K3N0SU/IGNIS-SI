"""IGNIS-SI API: microgravity droplet-fire simulation, sensing and response."""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import AsyncIterator

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from data.nasa_psi_corpus import corpus_as_dict, provenance
from ml import risk_ranker
from ml.features import LABELS, label_index
from ml.regime_classifier import RegimeClassifier, load_metrics
from ml.train import ensure_trained
from ml.uncertainty import assess, frontier_map
from physics.aerosol import compare_gravity
from physics.eclss import generate_protocol
from physics.low_flow import flow_response
from physics.properties import FUELS, Ambient
from physics.solver import SimulationConfig, simulate

from .schemas import (
    AerosolQuery,
    ChamberQuery,
    ClassifierTrace,
    ClassifyOut,
    EventOut,
    FlowSweepQuery,
    FrontierQuery,
    ProtocolOut,
    ProtocolStepOut,
    RiskWeights,
    SensorFrame,
    SimulationOut,
)

_state: dict[str, RegimeClassifier] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    _state["classifier"] = ensure_trained()
    yield
    _state.clear()


app = FastAPI(
    title="IGNIS-SI",
    version="1.0.0",
    description="Microgravity spacecraft fire-safety workbench: physics solver, sensor-fusion classifier and ECLSS response.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _classifier() -> RegimeClassifier:
    if "classifier" not in _state:
        _state["classifier"] = ensure_trained()
    return _state["classifier"]


def _config(q: ChamberQuery) -> SimulationConfig:
    return SimulationConfig(
        fuel=q.fuel, d0_mm=q.d0_mm, x_o2=q.x_o2, pressure_atm=q.pressure_atm,
        airflow_cm_s=q.airflow_cm_s, flow_mode=q.flow_mode, restore_delay_s=q.restore_delay_s,
        diluent=q.diluent, t_max_s=q.t_max_s, dt_s=q.dt_s,
    )


def _round(values: np.ndarray, digits: int = 5) -> list[float]:
    return [float(v) for v in np.round(values.astype(float), digits)]


@app.get("/api/health")
def health() -> dict[str, object]:
    metrics = load_metrics()
    return {
        "status": "ok",
        "classifier_loaded": "classifier" in _state,
        "classifier_accuracy": None if metrics is None else metrics["accuracy"],
        "fuels": list(FUELS),
    }


@app.post("/api/simulate", response_model=SimulationOut)
def run_simulation(query: ChamberQuery) -> SimulationOut:
    cfg = _config(query)
    started = time.perf_counter()
    result = simulate(cfg)
    solve_ms = (time.perf_counter() - started) * 1e3

    predicted = _classifier().predict_simulated(result.t, result.series)
    truth = [LABELS[label_index(r)] for r in result.regime]
    agreement = float(np.mean([p == t for p, t in zip(predicted.labels, truth)]))
    protocol = generate_protocol(cfg, result)

    return SimulationOut(
        query=query,
        t=_round(result.t, 3),
        series={k: _round(v) for k, v in result.series.items()},
        regime=result.regime,
        events=[EventOut(t=round(e.t, 3), kind=e.kind, detail=e.detail) for e in result.events],
        summary=result.summary,
        classifier=ClassifierTrace(labels=predicted.labels, confidence=_round(predicted.confidence, 4), agreement=round(agreement, 4)),
        protocol=ProtocolOut(
            hazard_level=protocol.hazard_level,
            headline=protocol.headline,
            steps=[ProtocolStepOut(**asdict(s)) for s in protocol.steps],
        ),
        provenance=provenance(cfg.fuel, cfg.d0_mm, cfg.x_o2, cfg.pressure_atm, cfg.airflow_cm_s),
        solve_ms=round(solve_ms, 2),
    )


@app.post("/api/classify", response_model=ClassifyOut)
def classify(frame: SensorFrame) -> ClassifyOut:
    n = len(frame.t)
    if not (len(frame.radiometer_w_m2) == len(frame.uv_intensity) == len(frame.co_o2_ratio) == n):
        raise HTTPException(status_code=422, detail="All sensor channels must have the same length as t.")
    out = _classifier().predict_series(
        np.asarray(frame.t), np.asarray(frame.radiometer_w_m2), np.asarray(frame.uv_intensity), np.asarray(frame.co_o2_ratio)
    )
    return ClassifyOut(
        labels=out.labels, confidence=_round(out.confidence, 4),
        probabilities=[_round(row, 4) for row in out.probabilities], label_order=list(LABELS),
    )


@app.post("/api/eclss", response_model=ProtocolOut)
def eclss(query: ChamberQuery) -> ProtocolOut:
    cfg = _config(query)
    protocol = generate_protocol(cfg, simulate(cfg))
    return ProtocolOut(
        hazard_level=protocol.hazard_level, headline=protocol.headline,
        steps=[ProtocolStepOut(**asdict(s)) for s in protocol.steps],
    )


@app.post("/api/uncertainty")
def uncertainty(query: ChamberQuery, ensemble: int = 12) -> dict[str, object]:
    if not 0 <= ensemble <= 32:
        raise HTTPException(status_code=422, detail="ensemble must be between 0 and 32.")
    return asdict(assess(_config(query), ensemble))


@app.post("/api/frontier")
def frontier(query: FrontierQuery) -> dict[str, object]:
    o2 = [round(0.10 + 0.01 * i, 2) for i in range(31)]
    airflow = [float(u) for u in range(0, 21)]
    return {
        "o2": o2,
        "airflow_cm_s": airflow,
        "verdict": frontier_map(query.fuel, query.d0_mm, query.pressure_atm, query.diluent, o2, airflow),
    }


@app.post("/api/flow-sweep")
def flow_sweep(query: FlowSweepQuery) -> dict[str, object]:
    # Geometric spacing resolves the 0-10 cm/s rise and the blowoff limit together.
    grid = [0.0] + [float(v) for v in np.geomspace(0.25, query.max_airflow_cm_s, query.points - 1)]
    ambient = Ambient(query.x_o2, query.pressure_atm, diluent=query.diluent)
    points = flow_response(query.fuel, ambient, query.diameter_mm * 1e-3, grid)
    return {"query": query.model_dump(), "points": [asdict(p) for p in points]}


@app.post("/api/aerosol")
def aerosol(query: AerosolQuery) -> dict[str, object]:
    runs = compare_gravity(
        query.primary_diameter_nm, query.initial_number_cm3, query.ventilation_cm_s, query.duration_s, query.pressure_atm
    )
    out: dict[str, object] = {"query": query.model_dump()}
    for name, r in runs.items():
        out[name] = {
            "t": _round(r.t, 2),
            "count_mean_diameter_nm": _round(r.count_mean_diameter_nm, 2),
            "mass_mean_diameter_nm": _round(r.mass_mean_diameter_nm, 2),
            "mass_fraction_above_1um": _round(r.mass_fraction_above_1um, 5),
            "ionization_per_mass": _round(r.ionization_per_mass, 5),
            "photoelectric_per_mass": _round(r.photoelectric_per_mass, 4),
            "mass_retained": _round(r.mass_retained, 6),
            "final_count_mean_diameter_nm": round(float(r.count_mean_diameter_nm[-1]), 1),
            "final_mass_fraction_above_1um": round(float(r.mass_fraction_above_1um[-1]), 4),
        }
    return out


@app.get("/api/risk")
def risk() -> dict[str, object]:
    return risk_ranker.leaderboard()


@app.post("/api/risk")
def risk_weighted(weights: RiskWeights) -> dict[str, object]:
    return risk_ranker.leaderboard(weights.model_dump())


@app.get("/api/corpus")
def corpus() -> dict[str, object]:
    return corpus_as_dict()


@app.get("/api/model-card")
def model_card() -> dict[str, object]:
    metrics = load_metrics()
    if metrics is None:
        raise HTTPException(status_code=503, detail="Classifier metrics are not available; run `python -m ml.train`.")
    return metrics

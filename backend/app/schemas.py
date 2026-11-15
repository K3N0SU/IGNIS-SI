"""Request and response models for the IGNIS-SI API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

FuelName = Literal["n-heptane", "n-decane", "n-dodecane", "methanol"]
DiluentName = Literal["N2", "CO2", "He"]
FlowModeName = Literal["CONTINUOUS", "RESTORE_AFTER_EXTINCTION"]


class ChamberQuery(BaseModel):
    fuel: FuelName = "n-heptane"
    d0_mm: float = Field(3.9, ge=0.8, le=6.0, description="Initial droplet diameter")
    x_o2: float = Field(0.21, ge=0.10, le=0.40, description="Oxygen mole fraction")
    pressure_atm: float = Field(1.0, ge=0.3, le=3.0)
    airflow_cm_s: float = Field(0.0, ge=0.0, le=60.0)
    flow_mode: FlowModeName = "CONTINUOUS"
    restore_delay_s: float = Field(3.0, ge=0.0, le=30.0)
    diluent: DiluentName = "N2"
    t_max_s: float = Field(60.0, ge=5.0, le=120.0)
    dt_s: float = Field(0.1, ge=0.02, le=0.5)


class EventOut(BaseModel):
    t: float
    kind: str
    detail: str


class ClassifierTrace(BaseModel):
    labels: list[str]
    confidence: list[float]
    agreement: float = Field(description="Fraction of samples where the classifier matches the solver regime")


class ProtocolStepOut(BaseModel):
    order: int
    code: str
    action: str
    status: str
    rationale: str
    parameters: dict[str, float | str | bool | None]


class ProtocolOut(BaseModel):
    hazard_level: str
    headline: str
    steps: list[ProtocolStepOut]


class SimulationOut(BaseModel):
    query: ChamberQuery
    t: list[float]
    series: dict[str, list[float]]
    regime: list[str]
    events: list[EventOut]
    summary: dict[str, float | str | bool | None]
    classifier: ClassifierTrace
    protocol: ProtocolOut
    provenance: dict[str, object]
    solve_ms: float


class SensorFrame(BaseModel):
    t: list[float] = Field(min_length=2)
    radiometer_w_m2: list[float]
    uv_intensity: list[float]
    co_o2_ratio: list[float]


class ClassifyOut(BaseModel):
    labels: list[str]
    confidence: list[float]
    probabilities: list[list[float]]
    label_order: list[str]


class FlowSweepQuery(BaseModel):
    fuel: FuelName = "n-heptane"
    diameter_mm: float = Field(3.0, ge=0.3, le=6.0)
    x_o2: float = Field(0.21, ge=0.10, le=0.40)
    pressure_atm: float = Field(1.0, ge=0.3, le=3.0)
    diluent: DiluentName = "N2"
    max_airflow_cm_s: float = Field(200.0, ge=5.0, le=400.0)
    points: int = Field(60, ge=8, le=200)


class AerosolQuery(BaseModel):
    primary_diameter_nm: float = Field(40.0, ge=10.0, le=200.0)
    initial_number_cm3: float = Field(3.0e9, ge=1.0e6, le=1.0e11)
    ventilation_cm_s: float = Field(0.0, ge=0.0, le=50.0)
    duration_s: float = Field(600.0, ge=30.0, le=3600.0)
    pressure_atm: float = Field(1.0, ge=0.3, le=1.5)


class RiskWeights(BaseModel):
    ignition: float = Field(0.40, ge=0.0, le=1.0)
    toxicity: float = Field(0.25, ge=0.0, le=1.0)
    suppression: float = Field(0.35, ge=0.0, le=1.0)


class FrontierQuery(BaseModel):
    fuel: FuelName = "n-heptane"
    d0_mm: float = Field(3.9, ge=0.8, le=6.0)
    pressure_atm: float = Field(1.0, ge=0.3, le=3.0)
    diluent: DiluentName = "N2"

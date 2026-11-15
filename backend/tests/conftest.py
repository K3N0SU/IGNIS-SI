from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from physics.solver import SimulationConfig, SimulationResult, simulate  # noqa: E402


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def baseline() -> SimulationResult:
    """n-heptane, 3.9 mm, air at 1 atm, quiescent: the FLEX cool-flame case."""
    return simulate(SimulationConfig())


@pytest.fixture(scope="session")
def backfire() -> SimulationResult:
    return simulate(SimulationConfig(airflow_cm_s=8.0, flow_mode="RESTORE_AFTER_EXTINCTION"))

"""Mission assistant: a tool-using agent that explains and drives the workbench.

The language model never supplies numbers of its own. It is given tools that
run the same solver, flight-data lookup and risk ranking the interface uses,
and it must call them to answer quantitative questions. It can also propose
a scenario, which the interface applies to the chamber controls.

Only the conversation text and compact tool results are sent to the model
provider. The API key is read from the environment or ``backend/.env`` and
is never logged or returned.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Any

import httpx

from data import investigations, psi_flight
from data.nasa_psi_corpus import datasets
from ml import risk_ranker
from ml.uncertainty import assess
from physics.eclss import generate_protocol
from physics.solver import SimulationConfig, simulate

from .serial import COMPUTE_LOCK

ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
FIT_PATH = Path(__file__).resolve().parents[1] / "data" / "calibration_fit.json"
API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-flash-latest"
MAX_TOOL_ROUNDS = 6
MAX_HISTORY = 16
MAX_MESSAGE_CHARS = 2000

SYSTEM_INSTRUCTION = """You are the IGNIS-SI mission assistant, embedded in a spacecraft fire-safety workbench.

What the workbench does: it simulates a single fuel droplet burning in microgravity (ISS Combustion Integrated Rack conditions), shows what an optical camera and a UV sensor would see, classifies the combustion regime from sensor signals, generates an ECLSS response protocol, and compares every condition with NASA flight tests from the Physical Sciences Informatics repository.

Core physics to explain when relevant, in plain language:
- Without buoyancy a large droplet's hot flame grows, radiates its heat away and goes out (radiative extinction).
- The fuel can keep burning as a "cool flame" near 700 K that emits no visible light. A colour camera shows nothing; UV and gas sensors still detect it. It produces carbon monoxide.
- Restarting cabin ventilation while a cool flame is present supplies oxygen and can re-ignite the hot flame.
- Lowering oxygen with nitrogen or carbon dioxide, or lowering pressure, removes the flame; the protocol computes the targets.
- When asked what NASA has learned, which experiments matter, or to compare or rank investigations, call compare_investigations and explain the ranking in plain language.

Rules:
1. Every number you state must come from a tool result or from the current state supplied with the request. If you need a number, call a tool. Never estimate or invent values, test identifiers or citations.
2. Keep two things separate and say which is which: NASA flight measurements (from get_flight_evidence) and model predictions (from run_simulation). If the condition is outside what NASA flew, say so plainly.
3. Write for a smart reader who is not a combustion scientist. Short paragraphs. Define a technical term the first time you use it. No headings, no bullet lists unless listing steps, no emoji.
4. Lead with the answer. Then the reason. Then, if useful, what to try next in the workbench.
5. When the user asks to see, try, set up or compare a scenario, call run_simulation to check it, then call apply_scenario so the workbench shows it, and tell the user what to look at.
6. You are a decision aid for analysis and training, not a flight controller. Do not present output as operational direction for a real emergency.
7. Stay on spacecraft fire safety and this workbench. Decline unrelated requests in one sentence.
8. Usually answer in under 150 words unless asked for depth."""

_SCENARIO_PROPERTIES: dict[str, Any] = {
    "fuel": {"type": "string", "enum": ["n-heptane", "n-decane", "n-dodecane", "methanol"]},
    "d0_mm": {"type": "number", "description": "Initial droplet diameter in mm, 1.5 to 5."},
    "o2_percent": {"type": "number", "description": "Oxygen in percent by volume, 14 to 30."},
    "pressure_atm": {"type": "number", "description": "Pressure in atm, 0.5 to 1.2."},
    "airflow_cm_s": {"type": "number", "description": "Ventilation airflow in cm/s, 0 to 20."},
    "fans_restart_after_flameout": {
        "type": "boolean",
        "description": "True: airflow starts only after the visible flame is lost. False: airflow is on throughout.",
    },
    "restart_delay_s": {"type": "number", "description": "Seconds between visible flame-out and fan restart, 0 to 20."},
    "diluent": {"type": "string", "enum": ["N2", "CO2", "He"]},
}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "run_simulation",
        "description": "Run the droplet-fire model for a chamber condition. Returns phases, timings, peak values, events, the ECLSS protocol and the data-coverage verdict. Omitted parameters keep the current workbench values.",
        "parameters": {"type": "object", "properties": _SCENARIO_PROPERTIES},
    },
    {
        "name": "get_flight_evidence",
        "description": "Find the NASA FLEX flight tests closest to a condition, with their measured burning rate, extinction diameter and outcome, and report whether the condition lies inside the flown envelope.",
        "parameters": {"type": "object", "properties": _SCENARIO_PROPERTIES},
    },
    {
        "name": "get_material_risk",
        "description": "Fire-hazard ranking of cabin materials across the ISS, 10.2 psia and Artemis atmospheres, with Saffire flight observations per material.",
        "parameters": {
            "type": "object",
            "properties": {"atmosphere": {"type": "string", "enum": ["ALL", "ISS", "EVA_PREP", "ARTEMIS"]}},
        },
    },
    {
        "name": "get_model_validation",
        "description": "How well the model reproduces NASA flight tests it was not fitted to: error in burning rate, extinction diameter and outcome, and which datasets are used.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "compare_investigations",
        "description": "Summarise, compare and rank NASA's microgravity combustion investigations (FLEX, FLEX-2, CFI, CFI-G, BASS, Saffire, SAME) for a condition: fuels, oxygen, pressure and airflow ranges, sensors, number of flight records, key findings and a relevance ranking with reasons.",
        "parameters": {"type": "object", "properties": _SCENARIO_PROPERTIES},
    },
    {
        "name": "apply_scenario",
        "description": "Load a scenario into the workbench controls so the user sees it. Call after run_simulation when the user wants to see or try something.",
        "parameters": {
            "type": "object",
            "properties": {
                **_SCENARIO_PROPERTIES,
                "sensor_view": {"type": "string", "enum": ["optical", "uv"], "description": "Which camera view to show."},
                "reason": {"type": "string", "description": "One short sentence shown to the user describing the scenario."},
            },
        },
    },
]


def _read_env_file() -> dict[str, str]:
    if not ENV_PATH.exists():
        return {}
    out: dict[str, str] = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, _, value = line.partition("=")
            out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def api_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY") or _read_env_file().get("GEMINI_API_KEY") or None


def model_name() -> str:
    return os.environ.get("GEMINI_MODEL") or _read_env_file().get("GEMINI_MODEL") or DEFAULT_MODEL


def status() -> dict[str, object]:
    return {"configured": api_key() is not None, "model": model_name(), "provider": "Google Gemini"}


def _clamp(value: Any, low: float, high: float, default: float) -> float:
    try:
        return min(max(float(value), low), high)
    except (TypeError, ValueError):
        return default


def scenario_from_args(args: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """Merge tool arguments over the current workbench query, clamped to the control ranges."""
    q = dict(current)
    if args.get("fuel") in ("n-heptane", "n-decane", "n-dodecane", "methanol"):
        q["fuel"] = args["fuel"]
    if args.get("diluent") in ("N2", "CO2", "He"):
        q["diluent"] = args["diluent"]
    if "d0_mm" in args:
        q["d0_mm"] = round(_clamp(args["d0_mm"], 1.5, 5.0, q["d0_mm"]), 1)
    if "o2_percent" in args:
        q["x_o2"] = round(_clamp(args["o2_percent"], 14.0, 30.0, q["x_o2"] * 100.0) / 100.0, 3)
    if "pressure_atm" in args:
        q["pressure_atm"] = round(_clamp(args["pressure_atm"], 0.5, 1.2, q["pressure_atm"]), 2)
    if "airflow_cm_s" in args:
        q["airflow_cm_s"] = round(_clamp(args["airflow_cm_s"], 0.0, 20.0, q["airflow_cm_s"]), 1)
    if "restart_delay_s" in args:
        q["restore_delay_s"] = round(_clamp(args["restart_delay_s"], 0.0, 20.0, q["restore_delay_s"]), 1)
    if "fans_restart_after_flameout" in args:
        q["flow_mode"] = "RESTORE_AFTER_EXTINCTION" if args["fans_restart_after_flameout"] else "CONTINUOUS"
    return q


def _config(q: dict[str, Any]) -> SimulationConfig:
    return SimulationConfig(
        fuel=q["fuel"], d0_mm=q["d0_mm"], x_o2=q["x_o2"], pressure_atm=q["pressure_atm"],
        airflow_cm_s=q["airflow_cm_s"], flow_mode=q["flow_mode"], restore_delay_s=q["restore_delay_s"],
        diluent=q["diluent"], t_max_s=60.0, dt_s=0.1,
    )


def _describe(q: dict[str, Any]) -> dict[str, Any]:
    return {
        "fuel": q["fuel"], "droplet_diameter_mm": q["d0_mm"], "oxygen_percent": round(q["x_o2"] * 100.0, 1),
        "pressure_atm": q["pressure_atm"], "diluent": q["diluent"], "airflow_cm_s": q["airflow_cm_s"],
        "airflow_schedule": "starts after visible flame-out" if q["flow_mode"] == "RESTORE_AFTER_EXTINCTION" else "continuous",
        "restart_delay_s": q["restore_delay_s"],
    }


def tool_run_simulation(q: dict[str, Any]) -> dict[str, Any]:
    cfg = _config(q)
    result = simulate(cfg)
    protocol = generate_protocol(cfg, result)
    verdict = assess(cfg, ensemble_size=0)
    return {
        "source": "model prediction, not flight data",
        "condition": _describe(q),
        "summary": result.summary,
        "events": [{"t_s": round(e.t, 1), "event": e.kind, "detail": e.detail} for e in result.events],
        "protocol": {
            "hazard_level": protocol.hazard_level,
            "headline": protocol.headline,
            "steps": [{"step": s.order, "action": s.action, "status": s.status, "why": s.rationale} for s in protocol.steps],
        },
        "data_coverage": {"verdict": verdict.verdict, "explanation": verdict.summary},
    }


def tool_flight_evidence(q: dict[str, Any]) -> dict[str, Any]:
    verdict = assess(_config(q), ensemble_size=0)
    return {
        "source": "NASA PSI-69 FLEX flight table (measured on the ISS)",
        "dataset_doi": "10.60555/mbq8-0451",
        "condition": _describe(q),
        "coverage_verdict": verdict.verdict,
        "coverage_explanation": verdict.summary,
        "parameters": [
            {"parameter": d.label, "query": d.value, "flown_low": d.tested_low, "flown_high": d.tested_high, "inside": d.inside}
            for d in verdict.dimensions
        ],
        "nearest_flight_tests": verdict.nearest_tests,
    }


def tool_material_risk(atmosphere: str) -> dict[str, Any]:
    entries = [asdict(e) for e in risk_ranker.rank() if atmosphere in ("ALL", "", e.atmosphere)]
    return {
        "source": "IGNIS-SI multi-criteria ranking from handbook material constants (indicative)",
        "entries": entries[:12],
        "saffire_flight_observations": [asdict(s) for s in psi_flight.load_saffire() if s.mission == "Saffire-II"],
    }


def tool_model_validation() -> dict[str, Any]:
    out: dict[str, Any] = {"datasets": [{k: d[k] for k in ("accession", "key", "title", "doi", "license", "rows")} for d in datasets()]}
    if FIT_PATH.exists():
        fit = json.loads(FIT_PATH.read_text(encoding="utf-8"))
        out["calibration"] = {
            "fitted_to": fit["dataset"], "method": fit["method"],
            "train_tests": fit["train_tests"], "holdout_tests": fit["holdout_tests"],
            "holdout_metrics_after_fit": fit["metrics"]["fitted_holdout"]["all"],
            "holdout_metrics_before_fit": fit["metrics"]["baseline_holdout"]["all"],
        }
    else:
        out["calibration"] = "Model constants are hand-set; no flight-data fit is stored."
    return out


def _execute(name: str, args: dict[str, Any], current: dict[str, Any], actions: list[dict[str, Any]]) -> dict[str, Any]:
    if name == "run_simulation":
        return tool_run_simulation(scenario_from_args(args, current))
    if name == "get_flight_evidence":
        return tool_flight_evidence(scenario_from_args(args, current))
    if name == "get_material_risk":
        return tool_material_risk(str(args.get("atmosphere", "ALL")))
    if name == "get_model_validation":
        return tool_model_validation()
    if name == "compare_investigations":
        q = scenario_from_args(args, current)
        scenario = investigations.Scenario(q["fuel"], q["d0_mm"], q["x_o2"], q["pressure_atm"], q["airflow_cm_s"])
        rows = investigations.compare(scenario)
        keep = ("rank", "name", "full_name", "type", "period", "fuels", "oxygen", "pressure", "airflow", "diagnostics", "records", "dataset_dois", "findings", "relevance", "why")
        return {"source": "NASA PSI investigation records and cited papers", "investigations": [{k: r[k] for k in keep} for r in rows]}
    if name == "apply_scenario":
        query = scenario_from_args(args, current)
        current.update(query)
        view = args.get("sensor_view") if args.get("sensor_view") in ("optical", "uv") else None
        actions.append({"type": "apply_scenario", "query": query, "sensor_view": view, "reason": str(args.get("reason", ""))[:200]})
        return {"applied": True, "condition": _describe(query), "sensor_view": view}
    return {"error": f"unknown tool {name}"}


class AssistantError(RuntimeError):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


def chat(messages: list[dict[str, str]], current_query: dict[str, Any], state_summary: dict[str, Any]) -> dict[str, Any]:
    key = api_key()
    if key is None:
        raise AssistantError("The assistant is not configured. Set GEMINI_API_KEY in backend/.env and restart the API.", 503)

    current = dict(current_query)
    contents: list[dict[str, Any]] = []
    for message in messages[-MAX_HISTORY:]:
        role = "model" if message.get("role") == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": str(message.get("content", ""))[:MAX_MESSAGE_CHARS]}]})
    if not contents or contents[-1]["role"] != "user":
        raise AssistantError("The last message must come from the user.", 422)
    state = json.dumps({"workbench_condition": _describe(current), "current_result": state_summary}, default=str)
    contents[-1]["parts"].insert(0, {"text": f"[Current workbench state]\n{state}\n\n[User]"})

    body_base: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "tools": [{"functionDeclarations": TOOLS}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 2048},
    }
    url = f"{API_ROOT}/{model_name()}:generateContent"
    actions: list[dict[str, Any]] = []
    trace: list[dict[str, Any]] = []

    with httpx.Client(timeout=60.0) as client:
        for _ in range(MAX_TOOL_ROUNDS):
            try:
                response = client.post(url, headers={"x-goog-api-key": key}, json={**body_base, "contents": contents})
            except httpx.HTTPError as err:
                raise AssistantError(f"Could not reach the model provider ({type(err).__name__}).", 502) from None
            if response.status_code != 200:
                try:
                    detail = response.json().get("error", {}).get("message", "")
                except ValueError:
                    detail = ""
                raise AssistantError(f"Model provider returned {response.status_code}. {detail[:300]}".strip(), 502)

            candidates = response.json().get("candidates") or []
            if not candidates:
                raise AssistantError("The model returned no answer.", 502)
            content = candidates[0].get("content") or {}
            parts = content.get("parts") or []
            calls = [p["functionCall"] for p in parts if "functionCall" in p]
            if not calls:
                text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
                if not text:
                    raise AssistantError("The model returned an empty answer.", 502)
                return {"reply": text, "actions": actions, "tool_calls": trace, "model": model_name()}

            contents.append({"role": "model", "parts": parts})
            responses: list[dict[str, Any]] = []
            for call in calls:
                name, args = str(call.get("name", "")), dict(call.get("args") or {})
                try:
                    with COMPUTE_LOCK:
                        result = _execute(name, args, current, actions)
                except Exception as err:  # a tool failure is reported to the model, not raised to the user
                    result = {"error": f"{type(err).__name__}: {err}"}
                trace.append({"name": name, "args": args})
                responses.append({"functionResponse": {"name": name, "response": {"result": result}}})
            contents.append({"role": "user", "parts": responses})

    raise AssistantError("The assistant did not finish within its tool budget. Try a narrower question.", 502)

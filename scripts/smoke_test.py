"""End-to-end smoke test of every API endpoint.

Runs against the backend directly and, unless --backend-only is given,
through the frontend proxy as well. Uses only the standard library.

Usage:  python scripts/smoke_test.py [--wait 60] [--backend-only]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

BACKEND = "http://127.0.0.1:8000"
FRONTEND = "http://localhost:3000"

Check = tuple[str, str, dict[str, Any] | None, Callable[[Any], bool]]

CHECKS: list[Check] = [
    ("GET", "/api/health", None, lambda b: b["status"] == "ok" and b["classifier_loaded"]),
    ("POST", "/api/simulate", {}, lambda b: b["summary"]["cool_flame_present"] and b["provenance"]["source"] == "model"),
    (
        "POST", "/api/simulate", {"airflow_cm_s": 8, "flow_mode": "RESTORE_AFTER_EXTINCTION"},
        lambda b: b["summary"]["reignition_count"] >= 1,
    ),
    ("POST", "/api/eclss", {}, lambda b: len(b["steps"]) == 5),
    ("POST", "/api/uncertainty?ensemble=4", {"airflow_cm_s": 8}, lambda b: b["verdict"] == "BEYOND_FRONTIER" and len(b["nearest_tests"]) == 5),
    ("POST", "/api/frontier", {}, lambda b: len(b["verdict"]) == len(b["airflow_cm_s"])),
    ("POST", "/api/flow-sweep", {"points": 24}, lambda b: len(b["points"]) == 24),
    ("POST", "/api/aerosol", {}, lambda b: b["microgravity"]["final_count_mean_diameter_nm"] > 1000),
    ("GET", "/api/risk", None, lambda b: len(b["entries"]) == 18),
    ("POST", "/api/risk", {"ignition": 1, "toxicity": 0, "suppression": 0}, lambda b: b["entries"][0]["rank"] == 1),
    ("GET", "/api/corpus", None, lambda b: len(b["experiments"]) >= 7),
    ("GET", "/api/model-card", None, lambda b: b["accuracy"] > 0.9),
    ("GET", "/api/flight/datasets", None, lambda b: len(b["datasets"]) == 11),
    ("GET", "/api/flight/flex", None, lambda b: len(b["tests"]) > 250 and b["calibration"] is not None),
    ("GET", "/api/flight/saffire", None, lambda b: len(b["samples"]) >= 10),
    ("GET", "/api/assistant/status", None, lambda b: "configured" in b),
    (
        "POST", "/api/classify",
        {"t": [0, 0.1, 0.2, 0.3], "radiometer_w_m2": [0.5] * 4, "uv_intensity": [2e-3] * 4, "co_o2_ratio": [0.35] * 4},
        lambda b: len(b["labels"]) == 4,
    ),
]


def call(base: str, method: str, path: str, body: dict[str, Any] | None) -> tuple[int, Any]:
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(base + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as err:
        return err.code, None


def wait_for(url: str, seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.5)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--wait", type=float, default=0.0, help="seconds to wait for the servers to come up")
    parser.add_argument("--backend-only", action="store_true")
    args = parser.parse_args()

    targets = [("backend", BACKEND)] if args.backend_only else [("backend", BACKEND), ("frontend proxy", FRONTEND)]
    failures = 0
    for name, base in targets:
        if args.wait and not wait_for(base + "/api/health", args.wait):
            print(f"FAIL  {name}: {base} did not become ready within {args.wait:.0f} s")
            return 1
        for method, path, body, ok in CHECKS:
            started = time.perf_counter()
            status, payload = call(base, method, path, body)
            elapsed = (time.perf_counter() - started) * 1e3
            passed = status == 200 and ok(payload)
            failures += not passed
            print(f"{'PASS' if passed else 'FAIL'}  {name:14s} {method:4s} {path:32s} {status}  {elapsed:6.0f} ms")
        status, _ = call(base, "POST", "/api/simulate", {"x_o2": 5})
        passed = status == 422
        failures += not passed
        print(f"{'PASS' if passed else 'FAIL'}  {name:14s} POST /api/simulate (invalid input)    {status}")

    if not args.backend_only:
        for page in ("/", "/analytics", "/flight"):
            try:
                with urllib.request.urlopen(FRONTEND + page, timeout=20) as response:
                    html = response.read().decode("utf-8", "replace")
                    passed = response.status == 200 and "IGNIS-SI" in html
            except (urllib.error.URLError, OSError):
                passed = False
            failures += not passed
            print(f"{'PASS' if passed else 'FAIL'}  frontend page  GET  {page}")

    print(f"\n{'ALL CHECKS PASSED' if failures == 0 else f'{failures} CHECK(S) FAILED'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

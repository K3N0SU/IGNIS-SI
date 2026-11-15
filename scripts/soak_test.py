"""Load the running API with concurrent, varied requests and report reliability.

Sends randomised chamber conditions to the simulation, uncertainty and
response-protocol endpoints from several threads. A request that fails is
retried after a pause, which is what the interface does; the report counts
first-attempt failures and requests that never succeeded.

Usage:  python scripts/soak_test.py [--requests 400] [--threads 4]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "http://127.0.0.1:8000"
FUELS = ("n-heptane", "n-decane", "n-dodecane", "methanol")
ENDPOINTS = ("/api/simulate", "/api/simulate", "/api/simulate", "/api/uncertainty?ensemble=6", "/api/eclss")


def condition(rng: random.Random) -> dict[str, object]:
    return {
        "fuel": rng.choice(FUELS),
        "d0_mm": round(rng.uniform(1.5, 5.0), 1),
        "x_o2": round(rng.uniform(0.14, 0.30), 3),
        "pressure_atm": round(rng.uniform(0.5, 1.2), 2),
        "airflow_cm_s": round(rng.choice((0.0, rng.uniform(0.0, 20.0))), 1),
        "flow_mode": rng.choice(("CONTINUOUS", "RESTORE_AFTER_EXTINCTION")),
        "restore_delay_s": round(rng.uniform(0.0, 12.0), 1),
        "diluent": rng.choice(("N2", "N2", "CO2", "He")),
    }


def post(path: str, body: dict[str, object]) -> bool:
    request = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            json.loads(response.read())
            return response.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def one(seed: int) -> tuple[bool, bool, float]:
    rng = random.Random(seed)
    path, body = rng.choice(ENDPOINTS), condition(rng)
    started = time.perf_counter()
    first = post(path, body)
    ok = first
    for _ in range(6):
        if ok:
            break
        time.sleep(2.0)
        ok = post(path, body)
    return first, ok, time.perf_counter() - started


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--requests", type=int, default=400)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.threads) as pool:
        results = list(pool.map(one, range(args.seed, args.seed + args.requests)))
    elapsed = time.perf_counter() - started
    first_failures = sum(not first for first, _, _ in results)
    lost = sum(not ok for _, ok, _ in results)
    times = sorted(t for _, _, t in results)
    print(json.dumps({
        "requests": len(results), "threads": args.threads, "elapsed_s": round(elapsed, 1),
        "first_attempt_failures": first_failures, "never_succeeded": lost,
        "median_s": round(times[len(times) // 2], 3), "p95_s": round(times[int(len(times) * 0.95)], 3),
    }))
    return 1 if lost else 0


if __name__ == "__main__":
    sys.exit(main())

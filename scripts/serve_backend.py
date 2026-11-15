"""Run the API under a supervisor that restarts it if the process dies.

The API is a single uvicorn process. If it exits abnormally (for example on
an interpreter fault) it is started again after a short pause, so the
interface recovers on its own. Restarts are rate-limited: more than
``MAX_RESTARTS`` within ``WINDOW_S`` seconds stops the supervisor, because a
process that cannot stay up needs attention, not another restart.

Usage:  python scripts/serve_backend.py [--port 8000]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
MAX_RESTARTS = 8
WINDOW_S = 300.0
PAUSE_S = 1.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    command = [
        sys.executable, "-m", "uvicorn", "app.main:app",
        "--host", args.host, "--port", str(args.port), "--log-level", "warning",
    ]
    restarts: list[float] = []
    while True:
        started = time.monotonic()
        process = subprocess.Popen(command, cwd=BACKEND)
        try:
            code = process.wait()
        except KeyboardInterrupt:
            process.terminate()
            return 0
        if code == 0:
            return 0
        now = time.monotonic()
        restarts = [t for t in restarts if now - t < WINDOW_S] + [now]
        print(f"[supervisor] API exited with code {code} after {now - started:.0f} s; restart {len(restarts)}", flush=True)
        if len(restarts) > MAX_RESTARTS:
            print("[supervisor] too many restarts; giving up", flush=True)
            return 1
        time.sleep(PAUSE_S)


if __name__ == "__main__":
    sys.exit(main())

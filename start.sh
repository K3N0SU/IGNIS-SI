#!/usr/bin/env bash
# IGNIS-SI: install, build, train, test, launch and smoke-test.
#
#   ./start.sh            full setup, then keep both servers running
#   ./start.sh --verify   full setup and checks, then stop the servers and exit
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-run}"
BACKEND_PID=""
FRONTEND_PID=""

step() { printf '\n== %s ==\n' "$1"; }

stop_servers() {
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  # On Windows the Node and Python children outlive the shell job; free the ports explicitly.
  if command -v taskkill >/dev/null 2>&1; then
    for port in 8000 3000; do
      for pid in $(netstat -ano 2>/dev/null | grep -E "[:.]${port} .*LISTENING" | awk '{print $NF}' | sort -u); do
        taskkill //F //PID "$pid" >/dev/null 2>&1 || true
      done
    done
  fi
}
trap stop_servers EXIT

PYTHON_BIN="$(command -v python3 || command -v python || true)"
[ -n "$PYTHON_BIN" ] || { echo "Python 3.11+ is required."; exit 1; }
command -v node >/dev/null || { echo "Node.js 20+ is required."; exit 1; }

# A server left running from an earlier launch holds file locks in
# node_modules on Windows, which makes `npm ci` fail.
stop_servers

step "Backend dependencies"
[ -d "$ROOT/backend/.venv" ] || "$PYTHON_BIN" -m venv "$ROOT/backend/.venv"
if [ -x "$ROOT/backend/.venv/bin/python" ]; then
  PY="$ROOT/backend/.venv/bin/python"
else
  PY="$ROOT/backend/.venv/Scripts/python.exe"
fi
"$PY" -m pip install --quiet --disable-pip-version-check -r "$ROOT/backend/requirements.txt"

step "Dataset generation and model training"
(cd "$ROOT/backend" && "$PY" -m ml.train --regenerate)

step "Backend unit tests"
(cd "$ROOT/backend" && "$PY" -m pytest -q)

step "Frontend dependencies and build"
cd "$ROOT/frontend"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund --loglevel=error; else npm install --no-audit --no-fund --loglevel=error; fi
npx tsc --noEmit
npx next build | tail -n 8

step "Launching servers"
stop_servers
(cd "$ROOT/backend" && exec "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level warning) &
BACKEND_PID=$!
(cd "$ROOT/frontend" && exec npx next start -p 3000) >/dev/null 2>&1 &
FRONTEND_PID=$!

step "API smoke test"
"$PY" "$ROOT/scripts/smoke_test.py" --wait 90

if [ "$MODE" = "--verify" ]; then
  step "Verification complete"
  exit 0
fi

printf '\nIGNIS-SI is running.\n  Workbench  http://localhost:3000\n  Analytics  http://localhost:3000/analytics\n  API docs   http://127.0.0.1:8000/docs\nPress Ctrl+C to stop.\n'
wait

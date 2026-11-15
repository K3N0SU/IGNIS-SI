#!/usr/bin/env bash
# Rebuild the frontend and restart the production server on port 3000.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

if command -v netstat >/dev/null 2>&1 && command -v taskkill >/dev/null 2>&1; then
  for pid in $(netstat -ano | grep -E "[:.]3000 .*LISTENING" | awk '{print $NF}' | sort -u); do
    taskkill //F //PID "$pid" >/dev/null 2>&1 || true
  done
else
  pkill -f "next start" >/dev/null 2>&1 || true
fi

cd "$root/frontend"
npx next build >"$root/scripts/.capture/build.log" 2>&1 || { tail -30 "$root/scripts/.capture/build.log"; exit 1; }
nohup npx next start -p 3000 >"$root/scripts/.capture/frontend.log" 2>&1 &
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:3000"; then echo "frontend ready"; exit 0; fi
  sleep 0.5
done
echo "frontend did not start"; exit 1

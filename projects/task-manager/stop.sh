#!/usr/bin/env bash
# ─── Agentic Service — Task Manager: stop ────────────────────────────────────
# Stops the server started by start.sh.
# Falls back to finding the process by port if server.pid is missing.
#
# Usage:
#   cd projects/task-manager
#   ./stop.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/server.pid"
PORT=8080

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'

stop_pid() {
  local pid="$1"
  kill "$pid" 2>/dev/null || true
  for i in $(seq 1 10); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.5
    if [[ $i -eq 10 ]]; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  rm -f "$PID_FILE"
  echo -e "${GREEN}Server stopped (PID $pid).${RESET}"
}

# ── Try PID file first ────────────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    stop_pid "$PID"
    exit 0
  else
    echo -e "${YELLOW}Stale PID file removed (process $PID already gone).${RESET}"
    rm -f "$PID_FILE"
  fi
fi

# ── Fallback: find by port ────────────────────────────────────────────────────
PID=$(lsof -ti tcp:"$PORT" 2>/dev/null | head -1 || true)

if [[ -z "$PID" ]]; then
  echo -e "${YELLOW}Nothing is listening on port $PORT.${RESET}"
  exit 0
fi

echo -e "${YELLOW}No server.pid found — stopping process on port $PORT (PID $PID).${RESET}"
stop_pid "$PID"

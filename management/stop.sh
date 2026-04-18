#!/usr/bin/env bash
# ─── Agentic Service — Management UI: stop ────────────────────────────────────
# Stops the management server started by start.sh (--prod / --build).
#
# In dev mode, start.sh runs in the foreground and Ctrl+C stops it.
# This script is for production mode where the server runs in the background.
#
# Usage:
#   ./management/stop.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/management.pid"
PORT=3100

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}Agentic Service — Management UI${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

stop_pid() {
  local pid="$1"
  local label="${2:-Server}"

  # Send SIGTERM for graceful shutdown
  kill "$pid" 2>/dev/null || true

  # Wait up to 5s for clean exit
  for i in $(seq 1 10); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.5
    if [[ $i -eq 10 ]]; then
      echo -e "  ${YELLOW}Forcing shutdown...${RESET}"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done

  echo -e "  ${GREEN}$label stopped${RESET} (PID $pid)"
}

# ── Try PID file first ────────────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    stop_pid "$PID" "Management server"
    rm -f "$PID_FILE"
    echo ""
    exit 0
  else
    echo -e "  ${YELLOW}Stale PID file removed (process $PID already gone).${RESET}"
    rm -f "$PID_FILE"
  fi
fi

# ── Fallback: find by port ────────────────────────────────────────────────────
PID=$(lsof -ti tcp:"$PORT" 2>/dev/null | head -1 || true)

if [[ -z "$PID" ]]; then
  echo -e "  ${YELLOW}Nothing is listening on port $PORT.${RESET}"
  echo ""
  exit 0
fi

echo -e "  ${YELLOW}No PID file — stopping process on port $PORT.${RESET}"
stop_pid "$PID" "Management server"
rm -f "$PID_FILE"
echo ""

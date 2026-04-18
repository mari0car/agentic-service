#!/usr/bin/env bash
# ─── agentic-service — stop ───────────────────────────────────────────────────
# Stops the management UI (and its Vite dev server) started by dev.sh.
# Projects running under the management UI are stopped by it on shutdown.
#
# Usage:
#   ./stop.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/management/management.pid"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

echo ""
echo "Stopping agentic-service..."
echo ""

# ── Management server (SIGTERM so it can gracefully stop any running projects) ─
if [[ -f "$PID_FILE" ]]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    for i in $(seq 1 20); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.3
      [[ $i -eq 20 ]] && kill -9 "$PID" 2>/dev/null || true
    done
    rm -f "$PID_FILE"
    echo -e "  ${GREEN}✓${RESET} Management server stopped (PID $PID)"
  else
    rm -f "$PID_FILE"
    echo -e "  ${YELLOW}–${RESET} Management server was not running (stale PID file removed)"
  fi
else
  # Fallback: find by port
  PID=$(lsof -ti tcp:3100 2>/dev/null | head -1 || true)
  if [[ -n "$PID" ]]; then
    kill "$PID" 2>/dev/null || true
    echo -e "  ${GREEN}✓${RESET} Management server stopped (PID $PID, found via port 3100)"
  else
    echo -e "  ${YELLOW}–${RESET} Management server was not running"
  fi
fi

# ── Vite dev server (child of the pnpm concurrently process) ─────────────────
VITE_PID=$(lsof -ti tcp:5173 2>/dev/null | head -1 || true)
if [[ -n "$VITE_PID" ]]; then
  kill "$VITE_PID" 2>/dev/null || true
  echo -e "  ${GREEN}✓${RESET} Vite dev server stopped (PID $VITE_PID)"
fi

echo ""

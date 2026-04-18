#!/usr/bin/env bash
# ─── Agentic Service — Management UI: start ───────────────────────────────────
# Starts the management server and Vite dev server for the browser-based UI.
#
# Usage:
#   ./management/start.sh              # dev mode (HMR + watch)
#   ./management/start.sh --prod       # production mode (serves built UI)
#   ./management/start.sh --build      # build first, then serve production
#
# The management UI lets you:
#   - Browse and manage all projects in projects/
#   - View and edit spec files, configs, migrations
#   - Start/stop project services and stream logs
#   - Test API endpoints with a built-in REST client
#   - Create new projects via LLM-assisted chat
#
# Management API:  http://localhost:3100/api
# Management UI:   http://localhost:5173  (dev) or http://localhost:3100 (prod)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Sandbox-safe TMPDIR (tsx needs a writable temp dir)
export TMPDIR=/tmp

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$SCRIPT_DIR/management.pid"
LOG_FILE="$SCRIPT_DIR/management.log"
PORT=3100

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; DIM='\033[2m'; RESET='\033[0m'

MODE="dev"
DO_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --prod)    MODE="prod" ;;
    --build)   MODE="prod"; DO_BUILD=true ;;
    --help|-h)
      echo "Usage: ./start.sh [--prod|--build]"
      echo ""
      echo "  (default)   Dev mode — Vite HMR on :5173, API server on :$PORT"
      echo "  --prod      Production — serve built UI from API server on :$PORT"
      echo "  --build     Build the UI first, then serve production"
      exit 0
      ;;
  esac
done

# ── Guard: already running? ───────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo -e "${YELLOW}Management server is already running (PID $OLD_PID).${RESET}"
    echo "  Run ./stop.sh first if you want to restart."
    exit 0
  else
    rm -f "$PID_FILE"
  fi
fi

# ── Preflight: check dependencies ────────────────────────────────────────────
cd "$SCRIPT_DIR"

if [[ ! -d "node_modules" ]]; then
  echo -e "${BOLD}Installing dependencies...${RESET}"
  (cd "$ROOT_DIR" && pnpm install --filter agentic-service-management...)
  echo ""
fi

# ── Header ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Agentic Service — Management UI${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Build (if requested) ─────────────────────────────────────────────────────
if [[ "$DO_BUILD" == true ]]; then
  echo -e "\n${BOLD}Building UI...${RESET}"
  npx vite build 2>&1 | sed 's/^/  /'
  echo -e "  ${GREEN}Build complete${RESET}"
fi

# ── Start server ─────────────────────────────────────────────────────────────
if [[ "$MODE" == "dev" ]]; then
  # Dev mode: run both server (with watch) and Vite in foreground
  echo -e "\n${BOLD}Starting in development mode${RESET}"
  echo -e "  ${DIM}Server watching for changes${RESET}"
  echo ""
  echo -e "  ${CYAN}Management API${RESET}  →  http://localhost:$PORT/api"
  echo -e "  ${CYAN}Management UI${RESET}   →  http://localhost:5173"
  echo ""
  echo -e "  ${DIM}Press Ctrl+C to stop both servers${RESET}"
  echo ""

  # Run in foreground so Ctrl+C stops everything
  exec npx concurrently \
    -n server,ui \
    -c blue,green \
    --kill-others \
    "npx tsx watch server/index.ts" \
    "npx vite"

else
  # Production mode: serve built UI from the Hono server
  if [[ ! -d "dist/ui" ]]; then
    echo -e "${RED}ERROR: Built UI not found at dist/ui/${RESET}"
    echo "  Run with --build to build first:  ./start.sh --build"
    exit 1
  fi

  echo -e "\n${BOLD}Starting in production mode${RESET}"

  npx tsx server/index.ts >"$LOG_FILE" 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$PID_FILE"

  # Wait until /api/health responds (up to 10s)
  for i in $(seq 1 20); do
    if curl -sf "http://localhost:$PORT/api/health" &>/dev/null; then
      break
    fi
    sleep 0.5
    if [[ $i -eq 20 ]]; then
      echo -e "${RED}ERROR: server did not start in time.${RESET}"
      echo "  Check $LOG_FILE for details."
      rm -f "$PID_FILE"
      exit 1
    fi
  done

  echo -e "  ${GREEN}Ready${RESET}  PID $SERVER_PID  →  logs: ./management.log"
  echo ""
  echo -e "  ${CYAN}Management UI + API${RESET}  →  http://localhost:$PORT"
  echo ""
  echo "  Run ./stop.sh to shut down."
  echo ""
fi

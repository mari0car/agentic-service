#!/usr/bin/env bash
# ─── agentic-service — dev startup ───────────────────────────────────────────
# Installs deps, builds, and starts the management UI.
# Projects (e.g. projects/task-manager) are started and stopped from
# the management UI itself — not from this script.
#
# Usage:
#   ./dev.sh                   # start (build only if dist/ is missing)
#   ./dev.sh --build           # force rebuild before starting
#   ./dev.sh --fresh           # clean install + rebuild + start
#
# Run ./stop.sh to shut the management UI down.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# tsx and node-gyp need a writable temp dir (system TMPDIR may be sandboxed)
export TMPDIR=/tmp

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BOLD='\033[1m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; DIM='\033[2m'; RED='\033[0;31m'; RESET='\033[0m'

DO_BUILD=false
DO_FRESH=false

for arg in "$@"; do
  case "$arg" in
    --build) DO_BUILD=true ;;
    --fresh) DO_FRESH=true; DO_BUILD=true ;;
    --help|-h)
      echo "Usage: ./dev.sh [--build|--fresh]"
      echo ""
      echo "  (default)   Start management UI (build only if dist/ is missing)"
      echo "  --build     Force rebuild before starting"
      echo "  --fresh     Clean install + rebuild + start"
      exit 0
      ;;
  esac
done

echo ""
echo -e "${BOLD}agentic-service — dev${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Clean install ─────────────────────────────────────────────────────────────
if [[ "$DO_FRESH" == true ]]; then
  echo -e "\n${BOLD}[1/3] Clean install${RESET}"
  rm -rf "$SCRIPT_DIR/node_modules" "$SCRIPT_DIR/management/node_modules" "$SCRIPT_DIR/dist"
  echo "  Removed node_modules and dist/"
  cd "$SCRIPT_DIR" && pnpm install
elif [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo -e "\n${BOLD}[1/3] Installing dependencies${RESET}"
  cd "$SCRIPT_DIR" && pnpm install
else
  echo -e "\n${DIM}[1/3] Dependencies already installed${RESET}"
fi

# ── Build ─────────────────────────────────────────────────────────────────────
if [[ "$DO_BUILD" == true ]] || [[ ! -f "$SCRIPT_DIR/dist/index.js" ]]; then
  echo -e "\n${BOLD}[2/3] Building${RESET}"
  cd "$SCRIPT_DIR" && pnpm run build
  echo -e "  ${GREEN}Build complete${RESET}  →  dist/index.js  dist/lib.js"
else
  echo -e "\n${DIM}[2/3] Build up to date (use --build to force)${RESET}"
fi

# ── Start management UI ───────────────────────────────────────────────────────
echo -e "\n${BOLD}[3/3] Starting management UI${RESET}"

cd "$SCRIPT_DIR"
pnpm run management > "$SCRIPT_DIR/management/management.log" 2>&1 &
MGMT_PID=$!
echo "$MGMT_PID" > "$SCRIPT_DIR/management/management.pid"

printf "  Waiting for management server"
for i in $(seq 1 40); do
  curl -sf "http://localhost:3100/api/health" &>/dev/null && break
  printf "."
  sleep 0.5
  if [[ $i -eq 40 ]]; then
    echo ""
    echo -e "${RED}ERROR: Management server did not start in time.${RESET}"
    echo "  Check: management/management.log"
    kill "$MGMT_PID" 2>/dev/null || true
    exit 1
  fi
done
echo ""

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "  ${GREEN}✓${RESET} Management UI  →  ${CYAN}http://localhost:5173${RESET}"
echo -e "  ${GREEN}✓${RESET} Management API →  ${CYAN}http://localhost:3100/api${RESET}"
echo ""
echo -e "  Use the UI to start, stop, and configure projects."
echo -e "  Log: ${DIM}management/management.log${RESET}"
echo ""
echo -e "  Run ${BOLD}./stop.sh${RESET} to shut down."
echo ""

#!/usr/bin/env bash
# ─── Agentic Service — Task Manager: start ────────────────────────────────────
# Starts the server in library mode (index.ts) so the tool-registry handlers
# are active for the four read-only routes.
#
# Usage:
#   cd projects/task-manager
#   export AGENTIC_AUTH_JWT_SECRET=my-secret-at-least-32-chars
#   ./start.sh
#
# To enable shadow verification (run LLM in parallel and compare outputs):
#   Add to config.yaml under tool_registry:
#     tool_registry:
#       shadow_mode: true
#       shadow_sample_rate: 1.0
#
# Logs are written to ./server.log
# PID is stored in  ./server.pid  (used by stop.sh)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Sandbox-safe TMPDIR (tsx needs a writable temp dir)
export TMPDIR=/tmp

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG="$SCRIPT_DIR/config.yaml"
DB_FILE="$SCRIPT_DIR/taskmanager.db"
PID_FILE="$SCRIPT_DIR/server.pid"
LOG_FILE="$SCRIPT_DIR/server.log"
PORT=8080

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'

# ── Guard: already running? ───────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo -e "${YELLOW}Server is already running (PID $OLD_PID).${RESET}"
    echo "  Run ./stop.sh first if you want to restart."
    exit 0
  else
    rm -f "$PID_FILE"
  fi
fi

# ── Preflight ─────────────────────────────────────────────────────────────────
if [[ -z "${AGENTIC_AUTH_JWT_SECRET:-}" ]]; then
  echo -e "${RED}ERROR: AGENTIC_AUTH_JWT_SECRET is not set.${RESET}"
  echo ""
  echo "  Export it before starting:"
  echo "    export AGENTIC_AUTH_JWT_SECRET=my-secret-at-least-32-chars"
  echo "    ./start.sh"
  exit 1
fi

# Library-mode start: runs index.ts which mounts the tool-registry
run_node() {
  node --import "tsx/esm" "$@"
}

# ── Migrate (first run) ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Agentic Service — Task Manager${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cd "$SCRIPT_DIR"

if [[ ! -f "$DB_FILE" ]]; then
  echo -e "\n${BOLD}Running migrations${RESET} (first start)"
  migrate_out=$(run_node "$ROOT_DIR/src/index.ts" migrate up --config "$CONFIG" 2>&1)
  echo "$migrate_out" | grep -E "Applied|No new" | sed 's/^/  /'
fi

# ── Start server (library mode via index.ts) ──────────────────────────────────
echo -e "\n${BOLD}Starting server${RESET} (library mode with tool-registry)"
run_node "$SCRIPT_DIR/index.ts" >"$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

# Wait until /healthz responds (up to 15s)
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/healthz" &>/dev/null; then
    break
  fi
  sleep 0.5
  if [[ $i -eq 30 ]]; then
    echo -e "${RED}ERROR: server did not start in time.${RESET}"
    echo "  Check $LOG_FILE for details."
    rm -f "$PID_FILE"
    exit 1
  fi
done

# ── Print summary ─────────────────────────────────────────────────────────────
echo -e "  ${GREEN}Ready${RESET}  PID $SERVER_PID  →  logs: ./server.log"
echo ""
echo -e "${BOLD}Base URL${RESET}"
echo "  http://localhost:$PORT"
echo ""
echo -e "${BOLD}Routes${RESET}"
echo "  POST   /api/auth/register         Register a new user (public)"
echo "  POST   /api/auth/login            Log in and get a JWT (public)"
echo ""
echo "  GET    /api/projects              List your projects          [tool-handler]"
echo "  POST   /api/projects              Create a project"
echo "  GET    /api/projects/:id          Get a project               [tool-handler]"
echo "  PUT    /api/projects/:id          Update a project"
echo ""
echo "  GET    /api/projects/:id/tasks    List tasks in a project     [tool-handler]"
echo "  POST   /api/projects/:id/tasks    Create a task"
echo "  GET    /api/projects/:id/tasks/:t Get a task                  [tool-handler]"
echo "  PUT    /api/projects/:id/tasks/:t Update a task"
echo ""
echo -e "${BOLD}Tool Registry${RESET}"
echo "  4 routes served by hand-authored handlers (~5-50ms vs ~1-5s for LLM)"
echo "  Inspect: GET http://localhost:$PORT/admin/tool-registry"
echo ""
echo -e "${BOLD}Shadow Mode${RESET} (verify handler vs LLM)"
echo "  Add to config.yaml to enable:"
echo "    tool_registry:"
echo "      shadow_mode: true"
echo "      shadow_sample_rate: 1.0    # 100% of handler requests also run LLM"
echo ""
echo -e "${BOLD}Auth${RESET}"
echo "  Protected routes require:  Authorization: Bearer <token>"
echo "  Get a token from /api/auth/register or /api/auth/login"
echo ""
echo -e "${BOLD}Quick start${RESET}"
cat <<'CURL'
  # Register
  curl -s -X POST http://localhost:8080/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{"email":"you@example.com","name":"Your Name","password":"yourpassword"}'

  # Log in (save the token)
  TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"you@example.com","password":"yourpassword"}' \
    | sed -E 's/.*"token":"([^"]+)".*/\1/')

  # Create a project
  curl -s -X POST http://localhost:8080/api/projects \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"name":"My Project"}'

  # List projects (served by tool-handler, not LLM)
  curl -s http://localhost:8080/api/projects \
    -H "Authorization: Bearer $TOKEN"
CURL
echo ""
echo "  Run ./stop.sh to shut down."
echo ""


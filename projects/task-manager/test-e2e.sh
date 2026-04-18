#!/usr/bin/env bash
# ─── Agentic Service — Task Manager end-to-end test ───────────────────────────
# Usage:
#   cd projects/task-manager
#   AGENTIC_AUTH_JWT_SECRET=my-secret ./test-e2e.sh
#
# The script:
#   1. Resets the local SQLite DB
#   2. Runs migrations
#   3. Starts the server in the background
#   4. Exercises all 8 API endpoints
#   5. Stops the server and reports a pass/fail summary
#
# Requirements: bash, curl, node >=22 with tsx (from project devDeps), jq (optional)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Sandbox-safe TMPDIR (tsx needs a writable temp dir)
export TMPDIR=/tmp

# ── Config ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG="$SCRIPT_DIR/config.yaml"
DB_FILE="$SCRIPT_DIR/taskmanager.db"
PORT=8080
SERVER_PID=""

# Colours
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
RESULTS=()

pass() { echo -e "  ${GREEN}✓${RESET} $1"; PASS=$((PASS+1)); RESULTS+=("PASS: $1"); }
fail() { echo -e "  ${RED}✗${RESET} $1"; FAIL=$((FAIL+1)); RESULTS+=("FAIL: $1"); }

check() {
  local label="$1"
  local expected_status="$2"
  local actual_status="$3"
  local body="$4"

  if [[ "$actual_status" == "$expected_status" ]]; then
    pass "$label (HTTP $actual_status)"
  else
    fail "$label — expected HTTP $expected_status, got $actual_status"
    echo -e "    ${YELLOW}Body: ${body:0:200}${RESET}"
  fi
}

# Extract a JSON field value — works on macOS and Linux without jq
json_field() {
  local json="$1"
  local field="$2"
  # Match "field":"value" or "field": "value" (string values)
  echo "$json" | sed -E 's/.*"'"$field"'"\s*:\s*"([^"]*)".*/\1/' | grep -v "^{" | head -1
}

run_node() {
  node --import "tsx/esm" "$ROOT_DIR/src/index.ts" "$@"
}

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Preflight ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Agentic Service — Task Manager E2E Test${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ -z "${AGENTIC_AUTH_JWT_SECRET:-}" ]]; then
  echo -e "${RED}ERROR: AGENTIC_AUTH_JWT_SECRET is not set.${RESET}"
  echo ""
  echo "  Export it before running:"
  echo "    export AGENTIC_AUTH_JWT_SECRET=my-secret-at-least-32-chars"
  echo "    ./test-e2e.sh"
  echo ""
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo -e "${RED}ERROR: node not found in PATH.${RESET}"
  exit 1
fi

# ── Reset DB ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[1/4] Resetting database${RESET}"
rm -f "$DB_FILE" "$DB_FILE-shm" "$DB_FILE-wal"
echo "  Deleted $DB_FILE"

# ── Migrations ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/4] Running migrations${RESET}"
cd "$SCRIPT_DIR"
migrate_out=$(run_node migrate up --config "$CONFIG" 2>&1)
echo "$migrate_out" | grep -E "Applied|No new" | sed 's/^/  /'

# ── Start server ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/4] Starting server (port $PORT)${RESET}"
run_node serve --config "$CONFIG" >/tmp/agentic-service-test.log 2>&1 &
SERVER_PID=$!

# Wait for it to be ready (up to 10s)
for i in $(seq 1 20); do
  if curl -sf "http://localhost:$PORT/healthz" &>/dev/null; then
    break
  fi
  sleep 0.5
  if [[ $i -eq 20 ]]; then
    echo -e "${RED}ERROR: Server failed to start. Log:${RESET}"
    tail -20 /tmp/agentic-service-test.log
    exit 1
  fi
done
echo "  Server ready (PID $SERVER_PID)"

# ── Tests ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/4] Running tests${RESET}"
echo ""

BASE="http://localhost:$PORT"

# Helper: make a request and capture status + body
request() {
  local method="$1"
  local url="$2"
  shift 2
  # remaining args forwarded to curl (headers, data, etc.)
  local response
  response=$(curl -s -w "\n__STATUS__%{http_code}" -X "$method" "$url" "$@" 2>/dev/null)
  local status="${response##*__STATUS__}"
  local body="${response%$'\n'__STATUS__*}"
  echo "$status|$body"
}

# ─── Auth ────────────────────────────────────────────────────────────────────
echo "  Auth"

# Register Alice
r=$(request POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","password":"password123"}')
STATUS="${r%%|*}"; BODY="${r#*|}"
check "Register user" "201" "$STATUS" "$BODY"
ALICE_TOKEN=$(json_field "$BODY" "token")
ALICE_ID=$(json_field "$BODY" "id")

# Duplicate register → 409
r=$(request POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","password":"password123"}')
STATUS="${r%%|*}"
check "Duplicate register → 409" "409" "$STATUS" "${r#*|}"

# Invalid email → 400
r=$(request POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email","name":"X","password":"password123"}')
STATUS="${r%%|*}"
check "Invalid email → 400" "400" "$STATUS" "${r#*|}"

# Login
r=$(request POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}')
STATUS="${r%%|*}"; BODY="${r#*|}"
check "Login" "200" "$STATUS" "$BODY"
# Use the fresh token from login for the rest of the tests
ALICE_TOKEN=$(json_field "$BODY" "token")

# Wrong password → 401
r=$(request POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"wrongpassword"}')
STATUS="${r%%|*}"
check "Wrong password → 401" "401" "$STATUS" "${r#*|}"

echo ""
echo "  Projects"

# Create project
r=$(request POST "$BASE/api/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d '{"name":"Alpha Project","description":"First project"}')
STATUS="${r%%|*}"; BODY="${r#*|}"
check "Create project" "201" "$STATUS" "$BODY"
PROJECT_ID=$(json_field "$BODY" "id")

# List projects
r=$(request GET "$BASE/api/projects" \
  -H "Authorization: Bearer $ALICE_TOKEN")
STATUS="${r%%|*}"; BODY="${r#*|}"
check "List projects" "200" "$STATUS" "$BODY"

# Get project
r=$(request GET "$BASE/api/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $ALICE_TOKEN")
STATUS="${r%%|*}"
check "Get project" "200" "$STATUS" "${r#*|}"

# Unauthenticated → 401
r=$(request GET "$BASE/api/projects")
STATUS="${r%%|*}"
check "No auth → 401" "401" "$STATUS" "${r#*|}"

echo ""
echo "  Tasks"

# Create task
r=$(request POST "$BASE/api/projects/$PROJECT_ID/tasks" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d '{"title":"Build the UI","description":"Frontend work","priority":"high"}')
STATUS="${r%%|*}"; BODY="${r#*|}"
check "Create task" "201" "$STATUS" "$BODY"
TASK_ID=$(json_field "$BODY" "id")

# List tasks
r=$(request GET "$BASE/api/projects/$PROJECT_ID/tasks" \
  -H "Authorization: Bearer $ALICE_TOKEN")
STATUS="${r%%|*}"
check "List tasks" "200" "$STATUS" "${r#*|}"

# Get task
r=$(request GET "$BASE/api/projects/$PROJECT_ID/tasks/$TASK_ID" \
  -H "Authorization: Bearer $ALICE_TOKEN")
STATUS="${r%%|*}"
check "Get task" "200" "$STATUS" "${r#*|}"

# Update task status
r=$(request PUT "$BASE/api/projects/$PROJECT_ID/tasks/$TASK_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d '{"status":"in_progress"}')
STATUS="${r%%|*}"
check "Update task status" "200" "$STATUS" "${r#*|}"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS+FAIL))
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All $TOTAL tests passed.${RESET}"
else
  echo -e "${RED}${BOLD}$FAIL/$TOTAL tests failed.${RESET}"
  echo ""
  for r in "${RESULTS[@]}"; do
    [[ "$r" == FAIL:* ]] && echo -e "  ${RED}$r${RESET}"
  done
fi
echo ""

[[ $FAIL -eq 0 ]]

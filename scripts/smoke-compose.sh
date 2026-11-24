#!/usr/bin/env bash
# Smoke test for `docker compose --profile apps up`: every service answers, and the main flows
# work end to end through the web app's own routes. Usage: scripts/smoke-compose.sh [base-url]
set -euo pipefail
BASE="${1:-http://localhost:3000}"
pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1"; exit 1; }

curl -sf "$BASE/" | grep -q "LineLab" && pass "web: home page" || fail "web: home page"
curl -sf "$BASE/sw.js" | grep -q "linelab-v1" && pass "web: service worker" || fail "web: service worker"
curl -sf "$BASE/manifest.webmanifest" | grep -q '"LineLab"' && pass "web: manifest" || fail "web: manifest"
curl -sf "http://localhost:4000/health" | grep -q '"ok"' && pass "api: health" || fail "api: health"
curl -sf "http://localhost:8000/health" | grep -q '"ok"' && pass "vision: health" || fail "vision: health"

# Compile the example sketch in the sandboxed compiler (through the web app's route).
SRC=$(python3 -c 'import json,sys;print(json.dumps(open("examples/firmware/good_pid/good_pid.ino").read()))')
curl -sf -X POST "$BASE/api/compile" -H 'content-type: application/json' \
  -d "{\"board\":\"arduino:avr:nano\",\"files\":{\"sketch.ino\":$SRC}}" | grep -q '"ok":true' \
  && pass "compiler: good_pid for the Nano" || fail "compiler: good_pid for the Nano"

# Gallery on Postgres: email sign-in (link from the API log), publish, read back.
JAR=$(mktemp)
EMAIL="smoke-$(date +%s)@example.com"
curl -sf -X POST "$BASE/api/auth/email/start" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\"}" >/dev/null
sleep 1
LINK=$(docker compose logs api 2>/dev/null | grep -o "Sign-in link for $EMAIL: [^ ]*" | tail -1 | sed 's/.*: //')
[ -n "$LINK" ] && pass "auth: email link in the API log" || fail "auth: email link in the API log"
curl -s -c "$JAR" -o /dev/null "${LINK/http:\/\/localhost:3000/$BASE}"
grep -q ll_session "$JAR" && pass "auth: signed in" || fail "auth: signed in"
DESIGN=$(cat packages/sim-core/fixtures/reference.design.json)
ID=$(curl -sf -b "$JAR" -X POST "$BASE/api/gallery" -H 'content-type: application/json' \
  -d "{\"title\":\"Smoke test robot\",\"design\":$DESIGN}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -sf "$BASE/api/gallery/$ID" | grep -q "Smoke test robot" && pass "gallery: publish + read ($ID)" || fail "gallery: publish + read"
curl -sf -b "$JAR" -X DELETE "$BASE/api/gallery/$ID" >/dev/null && pass "gallery: delete" || fail "gallery: delete"

# Knowledge base seeded with the synthetic cases (Postgres).
N=$(docker compose exec -T postgres psql -U linelab -d linelab -tAc "select count(*) from fix_cases where source='synthetic'")
[ "${N:-0}" -ge 8 ] && pass "knowledge base: $N synthetic cases" || fail "knowledge base: seed (got ${N:-0})"
M=$(docker compose exec -T postgres psql -U linelab -d linelab -tAc "select distinct embedding_model from fix_cases")
[ "$M" = "bge-small-en-v1.5" ] && pass "knowledge base: searched by meaning ($M)" || fail "knowledge base: embedding model is '$M'"
rm -f "$JAR"
echo "All good."

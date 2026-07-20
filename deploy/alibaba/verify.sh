#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

ENV_FILE="${ROOT}/.env.production"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f compose.production.yml)

[[ -f "${ROOT}/compose.production.yml" ]] || { echo "Refuse: not repository root." >&2; exit 1; }
[[ -f "${ENV_FILE}" ]] || { echo "Refuse: missing .env.production" >&2; exit 1; }

failures=0

ok() { echo "OK  $1"; }
fail() { echo "FAIL $1" >&2; failures=$((failures + 1)); }

echo "Compose service status:"
"${COMPOSE[@]}" ps

running_services="$("${COMPOSE[@]}" ps --status running --services)"
for service in postgres web worker-snapshot worker-planning worker-evidence worker-skeptic worker-judge nginx; do
  if printf '%s\n' "${running_services}" | grep -qx "${service}"; then
    ok "service running: ${service}"
  else
    fail "service running: ${service}"
  fi
done

if curl -fsS "http://127.0.0.1/api/health/live" >/dev/null; then
  ok "nginx liveness via /api/health/live"
else
  fail "nginx liveness via /api/health/live"
fi

if curl -fsS "http://127.0.0.1/api/health/ready" >/dev/null; then
  ok "nginx readiness via /api/health/ready"
else
  fail "nginx readiness via /api/health/ready"
fi

if curl -fsS "http://127.0.0.1/nginx-health" >/dev/null; then
  ok "nginx self health"
else
  fail "nginx self health"
fi

if "${COMPOSE[@]}" exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null; then
  ok "postgres healthy internally"
else
  fail "postgres healthy internally"
fi

ports_json="$("${COMPOSE[@]}" ps --format json 2>/dev/null || true)"
if printf '%s' "${ports_json}" | grep -Eq '"PublishedPort"[[:space:]]*:[[:space:]]*3000'; then
  fail "port 3000 not published"
else
  ok "port 3000 not published"
fi
if printf '%s' "${ports_json}" | grep -Eq '"PublishedPort"[[:space:]]*:[[:space:]]*5432'; then
  fail "port 5432 not published"
else
  ok "port 5432 not published"
fi

if command -v ss >/dev/null 2>&1; then
  if ss -ltn | grep -Eq '[:.]3000[[:space:]]'; then
    fail "host has no *:3000 listener"
  else
    ok "host has no *:3000 listener"
  fi
  if ss -ltn | grep -Eq '0\.0\.0\.0:5432|\*:5432|:::5432'; then
    fail "host has no public *:5432 listener"
  else
    ok "host has no public *:5432 listener"
  fi
fi

ps_text="$("${COMPOSE[@]}" ps)"
if printf '%s' "${ps_text}" | grep -Ei 'Restarting|Exit [1-9]' >/dev/null; then
  fail "no restart loops"
else
  ok "no restart loops"
fi

if [[ "${failures}" -gt 0 ]]; then
  echo "Verification failed (${failures} checks)." >&2
  exit 1
fi

echo "Verification passed."

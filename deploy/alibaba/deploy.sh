#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

ENV_FILE="${ROOT}/.env.production"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f compose.production.yml)

require_repo_root() {
  [[ -f "${ROOT}/package.json" && -f "${ROOT}/compose.production.yml" && -f "${ROOT}/Dockerfile" ]] \
    || { echo "Refuse: run from the Cernix repository (missing package.json / compose.production.yml / Dockerfile)." >&2; exit 1; }
}

require_env_file() {
  [[ -f "${ENV_FILE}" ]] || { echo "Refuse: ${ENV_FILE} is missing. Copy .env.production.example and chmod 600." >&2; exit 1; }
  local mode
  mode="$(stat -c '%a' "${ENV_FILE}" 2>/dev/null || stat -f '%OLp' "${ENV_FILE}")"
  if [[ "${mode}" != "600" && "${mode}" != "400" ]]; then
    echo "Refuse: ${ENV_FILE} mode is ${mode}; require 600 or stricter (chmod 600 .env.production)." >&2
    exit 1
  fi
}

require_docker() {
  command -v docker >/dev/null 2>&1 || { echo "Refuse: docker not found." >&2; exit 1; }
  docker version >/dev/null 2>&1 || { echo "Refuse: docker daemon not reachable." >&2; exit 1; }
  docker compose version >/dev/null 2>&1 || { echo "Refuse: docker compose not available." >&2; exit 1; }
}

require_env_names() {
  local missing=0
  local name
  for name in \
    POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL \
    AUTH_SECRET AUTH_URL AUTH_GITHUB_CLIENT_ID AUTH_GITHUB_CLIENT_SECRET \
    QWEN_API_KEY QWEN_API_ORIGIN
  do
    if ! grep -Eq "^${name}=" "${ENV_FILE}"; then
      echo "Refuse: missing required variable name ${name} in .env.production" >&2
      missing=1
    fi
  done
  [[ "${missing}" -eq 0 ]] || exit 1
  if grep -Eq '^CERNIX_INTEGRATION_TEST_DATABASE=' "${ENV_FILE}"; then
    echo "Refuse: CERNIX_INTEGRATION_TEST_DATABASE must not be set in production." >&2
    exit 1
  fi
}

require_repo_root
require_env_file
require_docker
require_env_names

echo "Building images sequentially (2 GiB host-safe)…"
"${COMPOSE[@]}" build --pull web
# Shared worker/migrate image target (no service named "worker").
"${COMPOSE[@]}" build migrate

echo "Starting stack (migrate runs once before web/workers)…"
"${COMPOSE[@]}" up -d

echo "Waiting for health through Nginx…"
attempts=0
until curl -fsS "http://127.0.0.1/api/health/live" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [[ "${attempts}" -ge 36 ]]; then
    echo "Refuse: liveness check did not become healthy in time." >&2
    "${COMPOSE[@]}" ps
    exit 1
  fi
  sleep 5
done

if ! curl -fsS "http://127.0.0.1/api/health/ready" >/dev/null 2>&1; then
  echo "Warning: readiness not yet ok; check web and postgres logs." >&2
fi

echo "Deploy complete. Safe status:"
"${COMPOSE[@]}" ps
echo "Public health: http://PUBLIC_IP_PLACEHOLDER/api/health/live"
echo "Remember: GitHub OAuth over HTTP will not work until domain + HTTPS (Secure cookies)."

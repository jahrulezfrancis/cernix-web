#!/usr/bin/env bash
# Disposable local smoke with Caddy tls internal (no public ACME).
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

PROJECT="${CERNIX_SMOKE_PROJECT:-cernix-smoke}"
ENV_FILE="$(mktemp)"
chmod 600 "${ENV_FILE}"
cleanup() {
  docker compose --env-file "${ENV_FILE}" -f compose.production.yml -p "${PROJECT}" down -v >/dev/null 2>&1 || true
  rm -f "${ENV_FILE}"
}
trap cleanup EXIT

cat >"${ENV_FILE}" <<'EOF'
POSTGRES_DB=cernix
POSTGRES_USER=cernix
POSTGRES_PASSWORD=SmokePass_9xYz
DATABASE_URL=postgresql://cernix:SmokePass_9xYz@postgres:5432/cernix
DATABASE_POOL_MAX=4
AUTH_SECRET=SmokeAuthSecret_at_least_32_chars_ok
AUTH_URL=https://localhost
AUTH_GITHUB_CLIENT_ID=smoke_oauth_client_id
AUTH_GITHUB_CLIENT_SECRET=smoke_oauth_client_secret
QWEN_API_KEY=smoke_qwen_key_not_live
QWEN_API_ORIGIN=https://dashscope-intl.aliyuncs.com
CERNIX_SITE_ADDRESS=localhost
CERNIX_CADDY_TLS_MODE=internal
CERNIX_ACME_EMAIL=
EOF

export CERNIX_COMPOSE_ENV_FILE="${ENV_FILE}"
export CERNIX_CADDYFILE="${ROOT}/deploy/alibaba/Caddyfile.smoke"
export CERNIX_HTTP_PORT=8080
export CERNIX_HTTPS_PORT=8443
export CERNIX_CADDY_TLS_MODE=internal
export CERNIX_ALLOW_INTERNAL_TLS=1
export ENV_FILE

# shellcheck source=common.sh
source "${ROOT}/deploy/alibaba/common.sh"

cernix_require_repo_root
cernix_require_docker
cernix_require_production_env

COMPOSE=(docker compose --env-file "${ENV_FILE}" -f compose.production.yml -p "${PROJECT}")

echo "Sequential builds…"
"${COMPOSE[@]}" build web
"${COMPOSE[@]}" build migrate

echo "Starting smoke stack (--no-build, internal TLS)…"
"${COMPOSE[@]}" up -d --no-build

echo "Waiting for HTTPS health…"
attempts=0
until curl -fsSk --resolve "localhost:8443:127.0.0.1" "https://localhost:8443/api/health/live" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [[ "${attempts}" -ge 48 ]]; then
    echo "Smoke liveness failed." >&2
    "${COMPOSE[@]}" ps >&2
    exit 1
  fi
  sleep 5
done

curl -fsSk --resolve "localhost:8443:127.0.0.1" "https://localhost:8443/api/health/ready" >/dev/null
code="$(curl -sS -o /dev/null -w '%{http_code}' --resolve "localhost:8080:127.0.0.1" "http://localhost:8080/api/health/live" || true)"
[[ "${code}" == "301" || "${code}" == "302" || "${code}" == "308" ]]

MIG="$("${COMPOSE[@]}" images -q migrate)"
for service in worker-snapshot worker-planning worker-evidence worker-skeptic worker-judge; do
  [[ "$("${COMPOSE[@]}" images -q "${service}")" == "${MIG}" ]]
done

ports="$("${COMPOSE[@]}" ps --format json)"
! printf '%s' "${ports}" | grep -Eq '"PublishedPort"[[:space:]]*:[[:space:]]*3000'
! printf '%s' "${ports}" | grep -Eq '"PublishedPort"[[:space:]]*:[[:space:]]*5432'

echo "Smoke passed (internal TLS, no public ACME)."
# cleanup trap tears down volumes/containers

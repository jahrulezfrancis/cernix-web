#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

ENV_FILE="${ROOT}/.env.production"
# shellcheck source=common.sh
source "${ROOT}/deploy/alibaba/common.sh"

cernix_require_repo_root
cernix_require_env_file
cernix_require_docker
cernix_require_production_env

failures=0

ok() { echo "OK  $1"; }
fail() { echo "FAIL $1" >&2; failures=$((failures + 1)); }

echo "Compose service status:"
cernix_compose ps

running_services="$(cernix_compose ps --status running --services)"
for service in postgres web worker-snapshot worker-planning worker-evidence worker-skeptic worker-judge nginx; do
  if printf '%s\n' "${running_services}" | grep -qx "${service}"; then
    ok "service running: ${service}"
  else
    fail "service running: ${service}"
  fi
done

base="$(cernix_http_base)"
if curl -fsS "${base}/api/health/live" >/dev/null; then
  ok "nginx liveness via /api/health/live (port ${CERNIX_HTTP_PORT})"
else
  fail "nginx liveness via /api/health/live (port ${CERNIX_HTTP_PORT})"
fi

if curl -fsS "${base}/api/health/ready" >/dev/null; then
  ok "nginx readiness via /api/health/ready (port ${CERNIX_HTTP_PORT})"
else
  fail "nginx readiness via /api/health/ready (port ${CERNIX_HTTP_PORT})"
fi

if curl -fsS "${base}/nginx-health" >/dev/null; then
  ok "nginx self health (port ${CERNIX_HTTP_PORT})"
else
  fail "nginx self health (port ${CERNIX_HTTP_PORT})"
fi

if cernix_compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null; then
  ok "postgres healthy internally"
else
  fail "postgres healthy internally"
fi

ports_json="$(cernix_compose ps --format json 2>/dev/null || true)"
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

# Shared worker image: migrate + all workers must resolve to the same image id.
migrate_image="$(cernix_compose images -q migrate 2>/dev/null | head -n 1 || true)"
image_mismatch=0
for service in worker-snapshot worker-planning worker-evidence worker-skeptic worker-judge; do
  worker_image="$(cernix_compose images -q "${service}" 2>/dev/null | head -n 1 || true)"
  if [[ -z "${migrate_image}" || -z "${worker_image}" || "${migrate_image}" != "${worker_image}" ]]; then
    image_mismatch=1
  fi
done
if [[ "${image_mismatch}" -eq 0 ]]; then
  ok "shared worker image id matches migrate and all workers"
else
  fail "shared worker image id matches migrate and all workers"
fi

ps_text="$(cernix_compose ps)"
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

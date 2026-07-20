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
for service in postgres web worker-snapshot worker-planning worker-evidence worker-skeptic worker-judge caddy; do
  if printf '%s\n' "${running_services}" | grep -qx "${service}"; then
    ok "service running: ${service}"
  else
    fail "service running: ${service}"
  fi
done

if cernix_curl_health /api/health/live >/dev/null; then
  ok "HTTPS liveness via /api/health/live"
else
  fail "HTTPS liveness via /api/health/live"
fi

if cernix_curl_health /api/health/ready >/dev/null; then
  ok "HTTPS readiness via /api/health/ready"
else
  fail "HTTPS readiness via /api/health/ready"
fi

if cernix_compose exec -T caddy wget -qO- http://127.0.0.1:9080/caddy-health >/dev/null; then
  ok "caddy internal health"
else
  fail "caddy internal health"
fi

if cernix_curl_http_redirect_check; then
  ok "HTTP to HTTPS redirect"
else
  fail "HTTP to HTTPS redirect"
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

# Expect published 80 and 443 (possibly remapped host ports).
if printf '%s' "${ports_json}" | grep -Eq '"TargetPort"[[:space:]]*:[[:space:]]*80'; then
  ok "container port 80 mapped"
else
  fail "container port 80 mapped"
fi
if printf '%s' "${ports_json}" | grep -Eq '"TargetPort"[[:space:]]*:[[:space:]]*443'; then
  ok "container port 443 mapped"
else
  fail "container port 443 mapped"
fi

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

# Certificate data volume must exist for persistence across recreate.
if cernix_compose exec -T caddy sh -c 'test -d /data/caddy'; then
  ok "caddy certificate data directory present"
else
  fail "caddy certificate data directory present"
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

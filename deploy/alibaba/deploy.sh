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

cernix_build_images_sequentially

echo "Starting stack with --no-build (migrate once, then web/workers/caddy)…"
cernix_compose up -d --no-build

echo "Waiting for HTTPS health…"
attempts=0
until cernix_curl_health /api/health/live >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [[ "${attempts}" -ge 48 ]]; then
    echo "Refuse: liveness check did not become healthy in time." >&2
    cernix_compose ps
    exit 1
  fi
  sleep 5
done

if ! cernix_curl_health /api/health/ready >/dev/null 2>&1; then
  echo "Warning: readiness not yet ok; check web and postgres logs." >&2
fi

echo "Deploy complete. Safe status:"
cernix_compose ps
site="$(cernix_env_value CERNIX_SITE_ADDRESS)"
echo "Public health: https://${site}/api/health/live"
echo "GitHub OAuth callback must be: https://${site}/api/auth/github/callback"
echo "Secure cookies remain enabled in production."

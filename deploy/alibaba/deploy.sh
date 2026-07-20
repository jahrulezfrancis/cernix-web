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

echo "Starting stack with --no-build (migrate once, then web/workers/nginx)…"
cernix_compose up -d --no-build

echo "Waiting for health through Nginx on port ${CERNIX_HTTP_PORT}…"
attempts=0
base="$(cernix_http_base)"
until curl -fsS "${base}/api/health/live" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [[ "${attempts}" -ge 36 ]]; then
    echo "Refuse: liveness check did not become healthy in time." >&2
    cernix_compose ps
    exit 1
  fi
  sleep 5
done

if ! curl -fsS "${base}/api/health/ready" >/dev/null 2>&1; then
  echo "Warning: readiness not yet ok; check web and postgres logs." >&2
fi

echo "Deploy complete. Safe status:"
cernix_compose ps
echo "Public health: ${base}/api/health/live (replace host for the ECS public address)"
echo "Remember: GitHub OAuth over HTTP will not work until domain + HTTPS (Secure cookies)."

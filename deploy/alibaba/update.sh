#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

ENV_FILE="${ROOT}/.env.production"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/cernix}"
# shellcheck source=common.sh
source "${ROOT}/deploy/alibaba/common.sh"

cernix_require_repo_root
cernix_require_env_file
cernix_require_docker
cernix_require_production_env

if [[ -n "$(git status --porcelain=v1)" ]]; then
  echo "Refuse: deployed Git worktree is dirty. Commit or stash before update." >&2
  git status -sb >&2
  exit 1
fi

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
echo "Recording previous commit ${PREVIOUS_COMMIT} for manual rollback."
mkdir -p "${BACKUP_ROOT}"
chmod 700 "${BACKUP_ROOT}"
echo "${PREVIOUS_COMMIT}" >"${BACKUP_ROOT}/last-app-commit.txt"
chmod 600 "${BACKUP_ROOT}/last-app-commit.txt"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_PATH="${BACKUP_ROOT}/cernix-${STAMP}.dump"
echo "Creating PostgreSQL backup at ${DUMP_PATH} (password not printed)…"
cernix_compose exec -T postgres \
  sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >"${DUMP_PATH}"
chmod 600 "${DUMP_PATH}"

echo "Fetching and fast-forwarding only…"
git fetch origin
DEFAULT_BRANCH="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main)"
git merge --ff-only "origin/${DEFAULT_BRANCH}"

cernix_build_images_sequentially

echo "Applying forward migrations via one-shot migrate service…"
cernix_compose up migrate --no-build --abort-on-container-exit --exit-code-from migrate

echo "Recreating application services (DB + Caddy cert volumes preserved; force-recreate caddy for conf)…"
cernix_compose up -d --no-build web worker-snapshot worker-planning worker-evidence worker-skeptic worker-judge
cernix_compose up -d --no-build --force-recreate caddy

echo "Update complete."
echo "Previous commit: ${PREVIOUS_COMMIT}"
echo "Current commit:  $(git rev-parse HEAD)"
echo "Database dump:   ${DUMP_PATH}"
echo "Caddy certificate volume cernix_caddy_data is preserved (no unnecessary reissuance)."
echo "Rollback app code manually with an explicit reviewed checkout; do not auto-run down migrations."

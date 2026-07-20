#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

ENV_FILE="${ROOT}/.env.production"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f compose.production.yml)
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/cernix}"

require_repo_root() {
  [[ -f "${ROOT}/package.json" && -f "${ROOT}/compose.production.yml" ]] \
    || { echo "Refuse: not repository root." >&2; exit 1; }
}

require_env_file() {
  [[ -f "${ENV_FILE}" ]] || { echo "Refuse: missing .env.production" >&2; exit 1; }
  local mode
  mode="$(stat -c '%a' "${ENV_FILE}" 2>/dev/null || stat -f '%OLp' "${ENV_FILE}")"
  if [[ "${mode}" != "600" && "${mode}" != "400" ]]; then
    echo "Refuse: .env.production mode must be 600 or stricter." >&2
    exit 1
  fi
}

require_clean_git() {
  if [[ -n "$(git status --porcelain=v1)" ]]; then
    echo "Refuse: deployed Git worktree is dirty. Commit or stash before update." >&2
    git status -sb >&2
    exit 1
  fi
}

require_repo_root
require_env_file
require_clean_git
command -v docker >/dev/null 2>&1 || { echo "Refuse: docker not found." >&2; exit 1; }

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
echo "Recording previous commit ${PREVIOUS_COMMIT} for manual rollback."
mkdir -p "${BACKUP_ROOT}"
chmod 700 "${BACKUP_ROOT}"
echo "${PREVIOUS_COMMIT}" >"${BACKUP_ROOT}/last-app-commit.txt"
chmod 600 "${BACKUP_ROOT}/last-app-commit.txt"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_PATH="${BACKUP_ROOT}/cernix-${STAMP}.dump"
echo "Creating PostgreSQL backup at ${DUMP_PATH} (password not printed)…"
"${COMPOSE[@]}" exec -T postgres \
  sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >"${DUMP_PATH}"
chmod 600 "${DUMP_PATH}"

echo "Fetching and fast-forwarding only…"
git fetch origin
DEFAULT_BRANCH="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo main)"
git merge --ff-only "origin/${DEFAULT_BRANCH}"

echo "Building updated images sequentially…"
"${COMPOSE[@]}" build web
"${COMPOSE[@]}" build migrate

echo "Applying forward migrations via one-shot migrate service…"
"${COMPOSE[@]}" up migrate --abort-on-container-exit --exit-code-from migrate

echo "Recreating application services (named volume preserved)…"
"${COMPOSE[@]}" up -d web worker-snapshot worker-planning worker-evidence worker-skeptic worker-judge nginx

echo "Update complete."
echo "Previous commit: ${PREVIOUS_COMMIT}"
echo "Current commit:  $(git rev-parse HEAD)"
echo "Database dump:   ${DUMP_PATH}"
echo "Rollback app code manually with an explicit reviewed checkout; do not auto-run down migrations."

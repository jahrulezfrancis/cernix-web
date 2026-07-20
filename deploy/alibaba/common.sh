# Shared helpers for Alibaba production scripts. Sourced only — not executed alone.
# shellcheck shell=bash

CERNIX_HTTP_PORT="${CERNIX_HTTP_PORT:-80}"
CERNIX_HTTPS_PORT="${CERNIX_HTTPS_PORT:-443}"
CERNIX_CADDY_TLS_MODE="${CERNIX_CADDY_TLS_MODE:-auto}"
CERNIX_ALLOW_INTERNAL_TLS="${CERNIX_ALLOW_INTERNAL_TLS:-0}"

cernix_compose() {
  docker compose --env-file "${ENV_FILE}" -f compose.production.yml "$@"
}

cernix_require_repo_root() {
  [[ -f "${ROOT}/package.json" && -f "${ROOT}/compose.production.yml" && -f "${ROOT}/Dockerfile" ]] \
    || { echo "Refuse: run from the Cernix repository (missing package.json / compose.production.yml / Dockerfile)." >&2; exit 1; }
}

cernix_require_env_file() {
  [[ -f "${ENV_FILE}" ]] || { echo "Refuse: ${ENV_FILE} is missing. Copy .env.production.example and chmod 600." >&2; exit 1; }
  local mode
  mode="$(stat -c '%a' "${ENV_FILE}" 2>/dev/null || stat -f '%OLp' "${ENV_FILE}")"
  if [[ "${mode}" != "600" && "${mode}" != "400" ]]; then
    echo "Refuse: ${ENV_FILE} mode is ${mode}; require 600 or stricter (chmod 600 .env.production)." >&2
    exit 1
  fi
}

cernix_require_docker() {
  command -v docker >/dev/null 2>&1 || { echo "Refuse: docker not found." >&2; exit 1; }
  docker version >/dev/null 2>&1 || { echo "Refuse: docker daemon not reachable." >&2; exit 1; }
  docker compose version >/dev/null 2>&1 || { echo "Refuse: docker compose not available." >&2; exit 1; }
}

# Read KEY=value from ENV_FILE without printing the value to the caller unless echoed by caller.
cernix_env_value() {
  local key="$1"
  local line raw
  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  [[ -n "${line}" ]] || return 1
  raw="${line#"${key}="}"
  if [[ "${raw}" == \"*\" && "${raw}" == *\" ]]; then
    raw="${raw:1:${#raw}-2}"
  elif [[ "${raw}" == \'*\' && "${raw}" == *\' ]]; then
    raw="${raw:1:${#raw}-2}"
  fi
  printf '%s' "${raw}"
}

cernix_refuse_placeholder_or_empty() {
  local key="$1"
  local value
  if ! value="$(cernix_env_value "${key}")"; then
    echo "Refuse: missing required variable ${key} in .env.production" >&2
    return 1
  fi
  if [[ -z "${value}" ]]; then
    echo "Refuse: ${key} is empty in .env.production" >&2
    return 1
  fi
  if [[ "${value}" == *replace_with_* || "${value}" == *PUBLIC_IP_PLACEHOLDER* ]]; then
    echo "Refuse: ${key} still contains a template placeholder; replace it before deploy." >&2
    return 1
  fi
  return 0
}

cernix_is_ipv4() {
  local host="$1"
  [[ "${host}" =~ ^[0-9]+(\.[0-9]+){3}$ ]]
}

cernix_is_hostname() {
  local host="$1"
  [[ "${host}" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$ ]] \
    || [[ "${host}" == "localhost" ]]
}

# Validates production .env without printing secret values.
cernix_require_production_env() {
  local missing=0
  local key
  for key in \
    POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL \
    AUTH_SECRET AUTH_URL AUTH_GITHUB_CLIENT_ID AUTH_GITHUB_CLIENT_SECRET \
    QWEN_API_KEY QWEN_API_ORIGIN CERNIX_SITE_ADDRESS
  do
    cernix_refuse_placeholder_or_empty "${key}" || missing=1
  done
  [[ "${missing}" -eq 0 ]] || exit 1

  local auth_secret
  auth_secret="$(cernix_env_value AUTH_SECRET)"
  if [[ "${#auth_secret}" -lt 32 ]]; then
    echo "Refuse: AUTH_SECRET must be at least 32 characters (length not printed)." >&2
    exit 1
  fi

  local database_url
  database_url="$(cernix_env_value DATABASE_URL)"
  if [[ ! "${database_url}" =~ ^postgres(ql)?:// ]]; then
    echo "Refuse: DATABASE_URL must use the postgres:// or postgresql:// scheme." >&2
    exit 1
  fi
  if [[ "${database_url}" != *@postgres:* ]]; then
    echo "Refuse: DATABASE_URL must use Compose hostname postgres on the backend network." >&2
    exit 1
  fi
  if [[ "${database_url}" == *@127.0.0.1:* || "${database_url}" == *@localhost:* ]]; then
    echo "Refuse: DATABASE_URL must target the Compose postgres service, not localhost." >&2
    exit 1
  fi
  if [[ "${database_url}" == */cernix_test || "${database_url}" == */cernix_test\?* ]]; then
    echo "Refuse: DATABASE_URL must not use the local integration database name cernix_test." >&2
    exit 1
  fi

  local site
  site="$(cernix_env_value CERNIX_SITE_ADDRESS)"
  site="${site%/}"
  if cernix_is_ipv4 "${site}"; then
    echo "Refuse: CERNIX_SITE_ADDRESS must be a DNS hostname, not an IP address." >&2
    exit 1
  fi
  if ! cernix_is_hostname "${site}"; then
    echo "Refuse: CERNIX_SITE_ADDRESS is not a valid hostname." >&2
    exit 1
  fi

  local auth_url expected
  auth_url="$(cernix_env_value AUTH_URL)"
  auth_url="${auth_url%/}"
  expected="https://${site}"
  if [[ "${auth_url}" != https://* ]]; then
    echo "Refuse: AUTH_URL must use https:// for production (Secure cookies)." >&2
    exit 1
  fi
  if [[ "${auth_url}" =~ ^https://[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    echo "Refuse: AUTH_URL must not use an IP-based origin." >&2
    exit 1
  fi
  if [[ "${auth_url}" != "${expected}" ]]; then
    echo "Refuse: AUTH_URL must exactly match https://\${CERNIX_SITE_ADDRESS} (no path or trailing slash)." >&2
    exit 1
  fi

  local tls_mode
  tls_mode="$(cernix_env_value CERNIX_CADDY_TLS_MODE 2>/dev/null || true)"
  tls_mode="${tls_mode:-${CERNIX_CADDY_TLS_MODE:-auto}}"
  if [[ "${tls_mode}" == "internal" ]]; then
    if [[ "${CERNIX_ALLOW_INTERNAL_TLS}" != "1" ]]; then
      echo "Refuse: CERNIX_CADDY_TLS_MODE=internal is smoke-only; set CERNIX_ALLOW_INTERNAL_TLS=1 for local smoke." >&2
      exit 1
    fi
  elif [[ "${tls_mode}" != "auto" && -n "${tls_mode}" ]]; then
    echo "Refuse: CERNIX_CADDY_TLS_MODE must be auto or internal." >&2
    exit 1
  fi

  local qwen_origin
  qwen_origin="$(cernix_env_value QWEN_API_ORIGIN)"
  if [[ "${qwen_origin}" != "https://dashscope.aliyuncs.com" \
     && "${qwen_origin}" != "https://dashscope-intl.aliyuncs.com" ]]; then
    echo "Refuse: QWEN_API_ORIGIN is not an allowlisted DashScope origin." >&2
    exit 1
  fi

  local forbidden
  for forbidden in \
    CERNIX_INTEGRATION_TEST_DATABASE \
    CERNIX_QWEN_LIVE_SMOKE \
    CERNIX_GITHUB_LIVE_SMOKE \
    GITHUB_LIVE_OWNER \
    GITHUB_LIVE_REPOSITORY \
    GITHUB_LIVE_COMMIT
  do
    if grep -Eq "^${forbidden}=" "${ENV_FILE}"; then
      echo "Refuse: ${forbidden} must not be set in production." >&2
      exit 1
    fi
  done
}

cernix_build_images_sequentially() {
  echo "Building images sequentially (shared worker image once)…"
  cernix_compose build web
  # Builds image tag cernix-worker:prod once via the migrate service build definition.
  cernix_compose build migrate
}

# HTTPS health base for verify/deploy probes.
cernix_https_base() {
  local site
  site="$(cernix_env_value CERNIX_SITE_ADDRESS)"
  if [[ "${CERNIX_CADDY_TLS_MODE}" == "internal" || "${CERNIX_ALLOW_INTERNAL_TLS}" == "1" ]]; then
    # Local smoke: probe remapped HTTPS port with insecure TLS (internal CA).
    printf 'https://127.0.0.1:%s' "${CERNIX_HTTPS_PORT}"
  else
    printf 'https://%s' "${site}"
  fi
}

cernix_curl_health() {
  local path="$1"
  local base
  base="$(cernix_https_base)"
  if [[ "${CERNIX_CADDY_TLS_MODE}" == "internal" || "${CERNIX_ALLOW_INTERNAL_TLS}" == "1" ]]; then
    local site
    site="$(cernix_env_value CERNIX_SITE_ADDRESS)"
    curl -fsSk --resolve "${site}:${CERNIX_HTTPS_PORT}:127.0.0.1" "https://${site}:${CERNIX_HTTPS_PORT}${path}"
  else
    curl -fsS "${base}${path}"
  fi
}

cernix_curl_http_redirect_check() {
  local site
  site="$(cernix_env_value CERNIX_SITE_ADDRESS)"
  local code
  if [[ "${CERNIX_CADDY_TLS_MODE}" == "internal" || "${CERNIX_ALLOW_INTERNAL_TLS}" == "1" ]]; then
    code="$(curl -sS -o /dev/null -w '%{http_code}' --resolve "${site}:${CERNIX_HTTP_PORT}:127.0.0.1" "http://${site}:${CERNIX_HTTP_PORT}/api/health/live" || true)"
  else
    code="$(curl -sS -o /dev/null -w '%{http_code}' "http://${site}/api/health/live" || true)"
  fi
  [[ "${code}" == "301" || "${code}" == "302" || "${code}" == "308" ]]
}

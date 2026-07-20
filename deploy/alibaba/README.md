# Alibaba Cloud ECS deployment (Cernix)

Hackathon-safe Docker production package for Ubuntu 24.04 ECS (2 vCPU / 2 GiB RAM / 2 GiB swap).

**This is not the local development Compose file.** Local PostgreSQL remains:

```bash
docker compose up -d postgres
```

Production always uses:

```bash
docker compose --env-file .env.production -f compose.production.yml <command>
```

Or the scripts under this directory.

## Topology

```text
Internet → ECS SG :80 → Nginx → Next.js :3000 (edge network)
                              ↘ PostgreSQL :5432 + five workers (backend network)
```

- Published host ports: **80 only** by default (`CERNIX_HTTP_PORT`, container still listens on 80). 443 is reserved for a future domain/TLS step and is not enabled here.
- Local rootless Docker may need `CERNIX_HTTP_PORT=8080` because binding host port 80 can require privileges; Alibaba ECS with standard Docker Engine should use 80.
- **Never** publish 3000 or 5432.
- Architecture diagram source: [`architecture.mmd`](./architecture.mmd).

## Prerequisites

| Item | Value |
| --- | --- |
| OS | Ubuntu 24.04 x64 |
| Region example | Germany (Frankfurt) |
| Docker Engine | 29.x (tested target 29.6.2) |
| Docker Compose | 5.x (tested target 5.3.1) |
| Swap | 2 GiB recommended on 2 GiB RAM hosts |
| Security group | inbound TCP 80 (and 443 later); SSH restricted separately |
| Domain | optional; initial scheme is HTTP to the public IPv4 |

## Why 3000 and 5432 stay private

Nginx is the only Internet-facing process. Next.js and PostgreSQL listen on the Docker networks only so judges and scanners cannot hit the app or database directly.

## Memory constraint

Target host: **2 GiB RAM + 2 GiB swap**. Leave ~500 MiB for Ubuntu/Docker.

Steady-state Compose `mem_limit` budget (excluding one-shot `migrate`):

| Service | mem_limit | Node heap (`NODE_OPTIONS`) |
| --- | ---: | ---: |
| postgres | 256 MiB | — |
| web | 384 MiB | 256 MiB |
| worker ×5 | 160 MiB each (800 MiB) | 128 MiB each |
| nginx | 48 MiB | — |
| **Total caps** | **1488 MiB** | |

`migrate` uses 192 MiB only while running. Images are built **sequentially**; `up` always uses `--no-build` so Compose cannot spawn concurrent missing-image builds. Shared worker tag: `cernix-worker:prod` (migrate + all five workers).

```bash
docker stats --no-stream
free -h
```

## Clone and environment setup

```bash
sudo mkdir -p /opt/cernix /var/backups/cernix
sudo chown "$USER":"$USER" /opt/cernix
chmod 700 /var/backups/cernix
cd /opt/cernix
git clone https://github.com/jahrulezfrancis/cernix-web.git .
git checkout main
git pull --ff-only

cp .env.production.example .env.production
chmod 600 .env.production
# Edit .env.production with a non-logging editor on the server.
# Never paste secrets into GitHub issues, commits, screenshots, demo video,
# chat, or shell commands that remain in history.
# Never commit .env.production. Rotate any secret accidentally exposed.
```

Replace `PUBLIC_IP_PLACEHOLDER` in `AUTH_URL` and document the same value in the GitHub OAuth App.

Set a strong `POSTGRES_PASSWORD` and the matching percent-encoded `DATABASE_URL` (host `postgres`, database `cernix`).

## GitHub OAuth (exact paths from code)

| Setting | Value |
| --- | --- |
| Homepage URL | `http://PUBLIC_IP_PLACEHOLDER` |
| Authorization callback URL | `http://PUBLIC_IP_PLACEHOLDER/api/auth/github/callback` |
| Env vars | `AUTH_SECRET` (≥32 chars), `AUTH_URL`, `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET` |

Nginx forwards `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto`. The app does **not** use Auth.js `AUTH_TRUST_HOST`; the public origin is exclusively `AUTH_URL`.

### HTTP IP blocker (do not weaken)

In production, session and OAuth cookies include the `Secure` attribute (`server/auth/cookies.ts`). Browsers will not store or send those cookies over plain HTTP. Therefore:

1. Health endpoints and the landing page can be demonstrated on the public IP over HTTP.
2. **GitHub sign-in will not work reliably until a domain and HTTPS terminate TLS in front of Nginx.**
3. Do not disable `Secure` cookies globally to make the IP demo “work.”

When a domain is ready (example `cernix.example.com`): terminate TLS at a load balancer or add Nginx 443 later, set `AUTH_URL=https://cernix.example.com`, and register callback `https://cernix.example.com/api/auth/github/callback`. Do not weaken Secure cookies.

## Qwen Cloud

| Item | Source |
| --- | --- |
| Secret env | `QWEN_API_KEY` |
| Origin env | `QWEN_API_ORIGIN` (allowlist: China default + `https://dashscope-intl.aliyuncs.com`) |
| Frankfurt / intl | set `QWEN_API_ORIGIN=https://dashscope-intl.aliyuncs.com` |
| Client path | `{origin}/compatible-mode/v1/chat/completions` |
| Default model | `qwen-plus` (`QWEN_MODEL_ID`) |

Workers call Qwen; the web container does not need a live Qwen call for health checks.

## Deploy

```bash
chmod +x deploy/alibaba/*.sh
./deploy/alibaba/deploy.sh
./deploy/alibaba/verify.sh
```

Manual equivalents (sequential builds, then start without building):

```bash
docker compose --env-file .env.production -f compose.production.yml build web
# Builds shared image tag cernix-worker:prod once (migrate declares the build).
docker compose --env-file .env.production -f compose.production.yml build migrate
docker compose --env-file .env.production -f compose.production.yml up -d --no-build
```

Do **not** invoke a Compose service named `worker` — that service does not exist. Worker containers reuse `cernix-worker:prod`.

### Migration verification

```bash
docker compose --env-file .env.production -f compose.production.yml run --rm --no-deps migrate
# Idempotent: completes successfully when already at latest.
```

### Logs (safe)

```bash
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 web
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 worker-snapshot
# … planning / evidence / skeptic / judge
```

Do not enable verbose SQL, token, cookie, or provider-body logging.

## Update

```bash
./deploy/alibaba/update.sh
```

Behavior: refuse dirty Git worktree → record previous commit → `pg_dump` to `/var/backups/cernix` → `git fetch` + fast-forward only → sequential rebuild → forward migrate → recreate app services. Named Postgres volume is preserved.

## Rollback

1. Application: check out the recorded commit in `/var/backups/cernix/last-app-commit.txt`, rebuild, and recreate web/workers. Do **not** automatically run `db:rollback`.
2. Database: restore only after explicit review using a timestamped dump under `/var/backups/cernix` (migrations may be destructive).

## Backup

`update.sh` creates restricted dumps. Manual:

```bash
mkdir -p /var/backups/cernix && chmod 700 /var/backups/cernix
docker compose --env-file .env.production -f compose.production.yml exec -T postgres \
  sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > /var/backups/cernix/cernix-manual.dump
chmod 600 /var/backups/cernix/cernix-manual.dump
```

Never commit backups into the repository.

## Reboot behavior

Postgres and Nginx use `restart: unless-stopped`. Web and workers use `restart: on-failure:5` to avoid unbounded restart storms on bad configuration. After ECS reboot, confirm with `./deploy/alibaba/verify.sh`.

## Proof links for Devpost

- Architecture diagram: `deploy/alibaba/architecture.mmd` (render in any Mermaid viewer)
- Health: `http://PUBLIC_IP_PLACEHOLDER/api/health/live`
- Readiness: `http://PUBLIC_IP_PLACEHOLDER/api/health/ready`
- Roles: Alibaba ECS host · PostgreSQL container · Qwen Cloud API · GitHub API

## Local Compose reminder

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Local Postgres only (`cernix_test` on loopback port 54329) |
| `compose.production.yml` | Full production stack |

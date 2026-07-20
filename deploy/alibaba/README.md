# Alibaba Cloud ECS deployment (Cernix)

Hackathon-safe Docker production package for Ubuntu 24.04 ECS (2 vCPU / 2 GiB RAM / 2 GiB swap) with **Caddy automatic HTTPS**.

| Fact | Value |
| --- | --- |
| Domain | `cernix.nigerianwebdeveloper.ng` |
| ECS public IPv4 (operator DNS target) | `8.211.121.29` |
| Production Compose file | `compose.production.yml` |
| Production env file | `.env.production` (from `.env.production.example`) |
| Edge | **Caddy** (Nginx is not used) |
| Health (live) | `GET /api/health/live` |
| Health (ready) | `GET /api/health/ready` |

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
Internet → ECS SG :80/:443 → Caddy (HTTPS + HTTP redirect)
                              → Next.js :3000 (edge network)
                              ↘ PostgreSQL :5432 + five workers (backend network)
```

- Published host ports: **80 and 443 only** (remap with `CERNIX_HTTP_PORT` / `CERNIX_HTTPS_PORT` for local rootless smoke).
- **Never** publish 3000 or 5432.
- Images: `cernix-web:prod` (Next standalone) and shared `cernix-worker:prod` (migrate + five workers). Only `migrate` declares `build:` for the worker target; `web` declares its own `build:` for the web target.
- Architecture diagram: [`architecture.mmd`](./architecture.mmd).

## Prerequisites

| Item | Value |
| --- | --- |
| OS | Ubuntu 24.04 x64 |
| DNS | `cernix.nigerianwebdeveloper.ng` A (and AAAA if used) → `8.211.121.29` |
| Docker Engine | 29.x |
| Docker Compose | 5.x |
| Swap | 2 GiB recommended |
| Security group | inbound TCP **80 and 443**; SSH restricted separately |

## Memory budget

Leave ~500 MiB for Ubuntu/Docker on a 2 GiB host.

| Service | mem_limit | Node heap |
| --- | ---: | ---: |
| postgres | 256 MiB | — |
| web | 384 MiB | 256 MiB |
| worker ×5 | 160 MiB each (800) | 128 MiB each |
| caddy | 64 MiB | — |
| **Steady total** | **1504 MiB** | |

`migrate` is 192 MiB one-shot (not part of steady state). Sequential `build web` → `build migrate` then `up --no-build`.

## Script order

| Script | Purpose |
| --- | --- |
| `./deploy/alibaba/deploy.sh` | Validate env → build web + worker images → `up -d --no-build` → wait for HTTPS live |
| `./deploy/alibaba/verify.sh` | Running services, HTTPS live/ready, Caddy health, redirect, ports, shared worker image |
| `./deploy/alibaba/update.sh` | Backup DB → ff-only pull → rebuild → one-shot migrate → recreate app + force-recreate **caddy** (cert volumes preserved) |
| `./deploy/alibaba/smoke.sh` | Local disposable stack with `Caddyfile.smoke` + internal TLS (no public ACME) |

---

## Production runbook (copy-paste)

Values you must supply are shown as `<PLACEHOLDER>`. Never commit `.env.production`.

### 1. Prepare the ECS server

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
# Install Docker Engine + Compose plugin per Docker's Ubuntu 24.04 instructions, then:
sudo usermod -aG docker "$USER"
# Log out and back in so the docker group applies.
free -h
# If swap is missing (~2 GiB recommended on this host size):
#   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
#   sudo mkswap /swapfile && sudo swapon /swapfile
```

### 2. Configure the firewall / security group

On the Alibaba Cloud security group attached to this ECS instance:

- Allow inbound **TCP 80** and **TCP 443** from the internet (or your demo audience).
- Restrict **SSH (22)** to your admin IPs.
- Do **not** open **5432** or **3000**.

Optional host firewall (if `ufw` is enabled):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Confirm DNS: `cernix.nigerianwebdeveloper.ng` A record → `8.211.121.29` before expecting public ACME to succeed.

### 3. Clone the repository

```bash
sudo mkdir -p /opt/cernix /var/backups/cernix
sudo chown "$USER":"$USER" /opt/cernix
chmod 700 /var/backups/cernix
cd /opt/cernix
git clone <GITHUB_REPOSITORY_URL> .
# After this branch is merged, prefer main:
git checkout main
git pull --ff-only
# Until merge, operators may temporarily use:
#   git checkout feat/alibaba-ecs-deployment && git pull --ff-only
chmod +x deploy/alibaba/*.sh
```

### 4. Create the production environment file

```bash
cd /opt/cernix
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production` on the server only. Required replacements:

| Variable | Operator value |
| --- | --- |
| `POSTGRES_PASSWORD` | `<POSTGRES_PASSWORD>` |
| `DATABASE_URL` | `postgresql://cernix:<POSTGRES_PASSWORD>@postgres:5432/cernix` (percent-encode reserved URL characters in the password) |
| `AUTH_SECRET` | `<AUTH_SECRET>` (≥ 32 random characters) |
| `AUTH_GITHUB_CLIENT_ID` | `<AUTH_GITHUB_ID>` |
| `AUTH_GITHUB_CLIENT_SECRET` | `<AUTH_GITHUB_SECRET>` |
| `QWEN_API_KEY` | `<DASHSCOPE_API_KEY>` |

Already correct in the example (keep unless intentionally changing):

- `CERNIX_SITE_ADDRESS=cernix.nigerianwebdeveloper.ng`
- `AUTH_URL=https://cernix.nigerianwebdeveloper.ng`
- `CERNIX_CADDY_TLS_MODE=auto`
- `QWEN_API_ORIGIN=https://dashscope-intl.aliyuncs.com` (or `https://dashscope.aliyuncs.com`)
- `POSTGRES_DB=cernix` / `POSTGRES_USER=cernix`

GitHub OAuth app:

- Homepage: `https://cernix.nigerianwebdeveloper.ng`
- Callback: `https://cernix.nigerianwebdeveloper.ng/api/auth/github/callback`

### 5. Validate the environment

```bash
cd /opt/cernix
# deploy.sh / update.sh / verify.sh call the same checks; dry-run via:
ENV_FILE=/opt/cernix/.env.production
# shellcheck source=common.sh
source deploy/alibaba/common.sh
cernix_require_env_file
cernix_require_production_env
echo "env ok"
```

Failures print variable **names** and reasons only — not secret values. Placeholders containing `replace_with_` are refused.

### 6. Build the application images

```bash
cd /opt/cernix
docker compose --env-file .env.production -f compose.production.yml build web
docker compose --env-file .env.production -f compose.production.yml build migrate
# migrate build produces shared tag cernix-worker:prod used by all workers.
```

Or: `./deploy/alibaba/deploy.sh` (builds then starts).

### 7–10. Start PostgreSQL, migrate, app, and Caddy

Preferred one-shot:

```bash
cd /opt/cernix
./deploy/alibaba/deploy.sh
```

This runs migrate as a one-shot dependency, then starts `web`, all five workers, and `caddy` with `--no-build`.

Manual equivalent:

```bash
cd /opt/cernix
docker compose --env-file .env.production -f compose.production.yml build web
docker compose --env-file .env.production -f compose.production.yml build migrate
docker compose --env-file .env.production -f compose.production.yml up -d --no-build
```

`postgres` starts first; `migrate` runs `tsx server/db/migrate-cli.ts up` once; `web` and workers wait for `migrate` success. Caddy waits for healthy `web`.

### 11. Configure HTTPS

With `CERNIX_CADDY_TLS_MODE=auto` and DNS pointing at `8.211.121.29`, Caddy obtains a Let's Encrypt certificate for `cernix.nigerianwebdeveloper.ng` automatically on first start. Certificates persist in volume **`cernix_caddy_data`**. No manual cert files are required.

HTTP (:80) redirects to HTTPS (:443). Do not place real certificates in the Git repo.

### 12. Check service status

```bash
cd /opt/cernix
./deploy/alibaba/verify.sh
# or:
docker compose --env-file .env.production -f compose.production.yml ps
```

Expected running: `postgres`, `web`, `worker-snapshot`, `worker-planning`, `worker-evidence`, `worker-skeptic`, `worker-judge`, `caddy`.

### 13. Read logs

```bash
cd /opt/cernix
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 web
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 caddy
docker compose --env-file .env.production -f compose.production.yml logs --tail=100 worker-judge
docker compose --env-file .env.production -f compose.production.yml logs -f worker-snapshot
```

### 14. Test the health endpoint

```bash
curl -fsS https://cernix.nigerianwebdeveloper.ng/api/health/live
curl -fsS https://cernix.nigerianwebdeveloper.ng/api/health/ready
# Expect JSON {"status":"live"} / ready equivalent; HTTP→HTTPS redirect on port 80.
```

### 15. Test persistence after restart

```bash
cd /opt/cernix
docker compose --env-file .env.production -f compose.production.yml restart web caddy
./deploy/alibaba/verify.sh
# Postgres data: volume cernix_prod_postgres_data
# TLS material: volume cernix_caddy_data (must survive caddy recreate)
```

### 16. Update the deployment later

```bash
cd /opt/cernix
./deploy/alibaba/update.sh
```

This records the previous commit under `/var/backups/cernix/last-app-commit.txt`, takes a `pg_dump`, fast-forwards to `origin/main`, rebuilds images, runs one-shot migrate, recreates app services, and **force-recreates caddy** while preserving cert volumes. Worktree must be clean.

### 17. Roll back to a previous commit

```bash
cd /opt/cernix
PREV="$(cat /var/backups/cernix/last-app-commit.txt)"
git checkout "$PREV"
docker compose --env-file .env.production -f compose.production.yml build web
docker compose --env-file .env.production -f compose.production.yml build migrate
docker compose --env-file .env.production -f compose.production.yml up -d --no-build
# Do NOT auto-run db:rollback. Restore DB only from a reviewed dump if schema is incompatible:
#   docker compose --env-file .env.production -f compose.production.yml exec -T postgres \
#     pg_restore -U cernix -d cernix --clean --if-exists < /var/backups/cernix/<dump>
```

---

## Caddy certificate lifecycle

1. On first start with DNS pointing at the ECS IP, Caddy obtains a publicly trusted certificate via ACME (Let's Encrypt) for `CERNIX_SITE_ADDRESS`.
2. Certificates and ACME account state persist in named volume **`cernix_caddy_data`** (`/data` in the container).
3. `update.sh` force-recreates the Caddy container for config reload but **preserves** `cernix_caddy_data` and `cernix_caddy_config`.
4. Caddy renews certificates automatically before expiry while the container runs.
5. Local smoke uses `Caddyfile.smoke` + `tls internal` and never contacts a public CA (`./deploy/alibaba/smoke.sh`).

## Local TLS-safe smoke (no public ACME)

```bash
./deploy/alibaba/smoke.sh
```

Uses `Caddyfile.smoke`, `CERNIX_ALLOW_INTERNAL_TLS=1`, ports 8080/8443, and tears down containers **and** volumes.

## Proof links

- Health: `https://cernix.nigerianwebdeveloper.ng/api/health/live`
- Ready: `https://cernix.nigerianwebdeveloper.ng/api/health/ready`
- Diagram: `deploy/alibaba/architecture.mmd`

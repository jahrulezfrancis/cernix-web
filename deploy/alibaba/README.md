# Alibaba Cloud ECS deployment (Cernix)

Hackathon-safe Docker production package for Ubuntu 24.04 ECS (2 vCPU / 2 GiB RAM / 2 GiB swap) with **Caddy automatic HTTPS**.

**Domain:** `cernix.nigerianwebdeveloper.ng`

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
                              → Next.js :3000 (edge)
                              ↘ PostgreSQL :5432 + five workers (backend)
```

- Published host ports: **80 and 443 only** (remap with `CERNIX_HTTP_PORT` / `CERNIX_HTTPS_PORT` for local rootless smoke).
- **Never** publish 3000 or 5432.
- Edge is **Caddy only** (Nginx is not used).
- Architecture diagram: [`architecture.mmd`](./architecture.mmd).

## Prerequisites

| Item | Value |
| --- | --- |
| OS | Ubuntu 24.04 x64 |
| DNS | `cernix.nigerianwebdeveloper.ng` A/AAAA → ECS public IPv4 |
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

`migrate` is 192 MiB one-shot. Shared worker image: `cernix-worker:prod`. Sequential `build` then `up --no-build`.

## Environment setup

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
# Edit secrets on-server only. Never commit .env.production.
```

Required public settings:

| Variable | Value |
| --- | --- |
| `CERNIX_SITE_ADDRESS` | `cernix.nigerianwebdeveloper.ng` |
| `AUTH_URL` | `https://cernix.nigerianwebdeveloper.ng` |
| `CERNIX_CADDY_TLS_MODE` | `auto` |

Deploy scripts reject HTTP origins, IP origins, placeholders, and `AUTH_URL` ≠ `https://${CERNIX_SITE_ADDRESS}`.

## GitHub OAuth

| Setting | Value |
| --- | --- |
| Homepage URL | `https://cernix.nigerianwebdeveloper.ng` |
| Callback URL | `https://cernix.nigerianwebdeveloper.ng/api/auth/github/callback` |

Production cookies keep the **Secure** attribute. Do not weaken them.

## Caddy certificate lifecycle

1. On first start with DNS pointing at the ECS IP, Caddy obtains a publicly trusted certificate via ACME (Let's Encrypt) for `CERNIX_SITE_ADDRESS`.
2. Certificates and ACME account state persist in named volume **`cernix_caddy_data`** (`/data` in the container).
3. `update.sh` force-recreates the Caddy container for config reload but **preserves** `cernix_caddy_data` and `cernix_caddy_config`, so renewals continue without unnecessary reissuance.
4. Caddy renews certificates automatically before expiry while the container runs.
5. Local smoke uses `Caddyfile.smoke` + `tls internal` and never contacts a public CA (`./deploy/alibaba/smoke.sh`).

## Deploy / update / verify

```bash
chmod +x deploy/alibaba/*.sh
./deploy/alibaba/deploy.sh
./deploy/alibaba/verify.sh
./deploy/alibaba/update.sh   # later
```

Manual:

```bash
docker compose --env-file .env.production -f compose.production.yml build web
docker compose --env-file .env.production -f compose.production.yml build migrate
docker compose --env-file .env.production -f compose.production.yml up -d --no-build
```

## Local TLS-safe smoke (no public ACME)

```bash
./deploy/alibaba/smoke.sh
```

Uses `Caddyfile.smoke`, `CERNIX_ALLOW_INTERNAL_TLS=1`, ports 8080/8443, and tears down containers **and** volumes.

## Rollback

1. App: checkout `/var/backups/cernix/last-app-commit.txt`, rebuild, `up --no-build`. Do not auto-run `db:rollback`.
2. DB: restore reviewed `pg_dump` under `/var/backups/cernix`.
3. Certs: leave `cernix_caddy_data` intact unless intentionally rotating.

## Proof links

- Health: `https://cernix.nigerianwebdeveloper.ng/api/health/live`
- Ready: `https://cernix.nigerianwebdeveloper.ng/api/health/ready`
- Diagram: `deploy/alibaba/architecture.mmd`

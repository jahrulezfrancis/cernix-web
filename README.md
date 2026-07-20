# Cernix

Cernix investigates **one verifiable technical claim** against a **public GitHub repository** at an exact commit. Specialized workers snapshot the repo, plan obligations with Qwen (Alibaba DashScope), retrieve admitted evidence, run a skeptic pass, and produce a durable evidence report tied to that snapshot.

The UI shows real backend progress and reports. `/sample-report` is an illustrative static example only.

**Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

**Production (Alibaba ECS):** [deploy/alibaba/README.md](deploy/alibaba/README.md) — use `compose.production.yml`, never the local `docker-compose.yml`.

## Prerequisites

- Node.js 20.9+ (`nvm use`)
- Docker (for local PostgreSQL)
- [GitHub OAuth App](https://github.com/settings/developers) with callback `http://localhost:3000/api/auth/github/callback`
- [DashScope API key](https://www.alibabacloud.com/help/en/model-studio/get-api-key) (`QWEN_API_KEY`)

## Quick start

```bash
git clone https://github.com/jahrulezfrancis/cernix-web.git
cd cernix-web
npm ci

cp .env.example .env.local
# Fill AUTH_*, QWEN_API_KEY, and GitHub OAuth values in .env.local

docker compose up -d postgres
npm run db:migrate
```

In **six terminals** (or use a process manager):

```bash
# Terminal 1 — web app
npm run dev

# Terminals 2–6 — workers (all required for a full investigation)
npm run worker:snapshot
npm run worker:planning
npm run worker:evidence
npm run worker:skeptic
npm run worker:judge
```

Open [http://localhost:3000](http://localhost:3000), sign in with GitHub, and create an investigation.

## Run a full investigation

1. **New investigation** — public GitHub URL, optional branch, submission context, and a **focus claim** (one statement to verify).
2. **Claim review** — edit the claim if needed, then approve and start.
3. **Live** — watch snapshot → plan → evidence → skeptic → judge (polls every 2s).
4. **Report** — available when status is `completed` or `completed_with_limitations`.

Workers must be running before you start. A `GITHUB_TOKEN` in `.env.local` raises GitHub API rate limits but is optional for public repos.

## Environment variables

Copy `.env.example` to `.env.local`. Minimum for local development:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Session signing secret (32+ random bytes) |
| `AUTH_URL` | App origin, e.g. `http://localhost:3000` |
| `AUTH_GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `AUTH_GITHUB_CLIENT_SECRET` | GitHub OAuth app secret |
| `QWEN_API_KEY` | DashScope API key |
| `QWEN_API_ORIGIN` | DashScope base URL (intl: `https://dashscope-intl.aliyuncs.com`) |
| `GITHUB_TOKEN` | Optional; higher GitHub rate limits |

Worker lease, retry, and evidence bounds use `CERNIX_*` variables documented in `.env.example`. Each worker runs as a separate process with its own `CERNIX_*_WORKER_OWNER` (auto-generated if empty).

## Authentication

Investigations and `/api/v1/*` routes require a GitHub session. Unauthenticated users are redirected to `/login`. Create a GitHub OAuth app and set the callback to:

```text
${AUTH_URL}/api/auth/github/callback
```

## Public API

Versioned routes under `/api/v1/investigations`. Mutations require `Idempotency-Key: <uuid>`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/investigations` | Create investigation + manual claim |
| `GET` | `/api/v1/investigations` | List your investigations |
| `GET` | `/api/v1/investigations/:id` | Read investigation |
| `PATCH` | `/api/v1/investigations/:id/claims` | Approve or edit claim |
| `POST` | `/api/v1/investigations/:id/start` | Start snapshotting |
| `GET` | `/api/v1/investigations/:id/events` | Paginated lifecycle events |
| `GET` | `/api/v1/investigations/:id/report` | Durable judge report |

## Testing

```bash
export DATABASE_URL=postgresql://cernix_demo:cernix_demo@127.0.0.1:54329/cernix_test
export CERNIX_INTEGRATION_TEST_DATABASE=1
npm run db:migrate
npm run test
npm run test:integration
```

Integration tests require the Docker Postgres service and explicit opt-in. See `.env.example` for live smoke flags (`CERNIX_QWEN_LIVE_SMOKE`, `CERNIX_GITHUB_LIVE_SMOKE`).

## Hackathon — Global AI Hackathon (Qwen Cloud)

**Track:** Autopilot Agent (Track 4)

Cernix fits Track 4 as a multi-step autonomous workflow with external tools (GitHub), human-in-the-loop claim approval, and production-style durable orchestration.

| Submission item | Location |
| --- | --- |
| Public repository | This repo (MIT license) |
| Alibaba Cloud deployment | ECS + RDS (see deployment notes below) |
| Alibaba API usage | [`server/qwen/client.ts`](server/qwen/client.ts) — DashScope chat completions |
| Architecture diagram | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Demo video | Walk through login → claim → live agents → report |
| Sample output | [`/sample-report`](http://localhost:3000/sample-report) (illustrative) |

**Honest scope for judges:** MVP verifies **one user-defined claim** per investigation over **admitted snapshot files** (not runtime execution, private repos, or full CI/cloud forensics). Verdicts distinguish verified repository evidence from model interpretation and documented limitations.

### Deployment (Alibaba Cloud)

Production requires the web app, all five workers, and managed PostgreSQL with TLS. Before go-live:

1. Run `npm run db:migrate` against production `DATABASE_URL`
2. Set production `AUTH_URL` and update the GitHub OAuth callback
3. Supervise web + workers (systemd, Docker Compose, or SAE)
4. Never use `rejectUnauthorized: false` for RDS TLS

Detailed runbook: forthcoming in `docs/DEPLOYMENT.md` (ECS/RDS provisioning).

## Multi-agent pipeline

```text
User approves claim
  → Snapshot worker (GitHub → immutable manifest)
  → Planning worker (Qwen → investigation plan)
  → Evidence worker (lexical search + Qwen over admitted files)
  → Skeptic worker (Qwen challenges provisional conclusions)
  → Judge worker (Qwen → durable report)
```

Jobs use PostgreSQL `FOR UPDATE SKIP LOCKED`, lease tokens, heartbeats, and idempotent replay. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for lifecycle and ownership details.

## Database development

Local Postgres 17 via Docker Compose (port `54329`). Demo credentials are loopback-only:

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://cernix_demo:cernix_demo@127.0.0.1:54329/cernix_test
npm run db:migrate
```

Use `npm run db:rollback` to roll back one migration during development. Migrations never run during `next build`.

Integration tests create a randomized child database per run, migrate from empty, and drop only that child on cleanup. They refuse to run unless `CERNIX_INTEGRATION_TEST_DATABASE=1`, the host is numeric `127.0.0.1`, and the database name ends in `_test`.

## Immutable GitHub snapshots

Snapshot ingest resolves a public repo ref to an exact commit, enumerates the tree with bounded breadth-first fallback, applies admission policy v1, verifies Git blob identity, and persists one immutable snapshot per investigation. Repository source is never cloned, built, or executed.

Configuration is read lazily from environment variables (see `.env.example`). Offline fixtures cover enumeration and replay; CI does not call GitHub.

## License

MIT — see [LICENSE](LICENSE).

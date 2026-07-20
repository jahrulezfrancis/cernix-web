# Cernix architecture

Cernix is an evidence-driven investigation platform for public GitHub repositories. A user defines one verifiable claim, approves it, and durable workers orchestrate snapshotting, planning, evidence retrieval, skeptic review, and final judgment. The web app reads PostgreSQL state; workers advance lifecycle stages asynchronously.

## System overview

```mermaid
flowchart TB
  subgraph User["User browser"]
    UI["Next.js app\n(React UI)"]
  end

  subgraph Web["Web process"]
    API["/api/v1/investigations\n/api/auth/*"]
    MW["Auth middleware\n(session cookie)"]
  end

  subgraph Workers["Worker processes (5)"]
    W1["Snapshot worker"]
    W2["Planning worker"]
    W3["Evidence worker"]
    W4["Skeptic worker"]
    W5["Judge worker"]
  end

  subgraph Data["PostgreSQL"]
    DB[("Investigations\nJobs · Events\nReports")]
  end

  subgraph External["External services"]
    GH["GitHub REST API\n(public repos)"]
    QW["Alibaba DashScope\n(Qwen models)"]
  end

  UI --> MW --> API
  API --> DB
  W1 & W2 & W3 & W4 & W5 --> DB
  W1 --> GH
  W2 & W3 & W4 & W5 --> QW
  W3 --> GH
```

## Investigation lifecycle

```mermaid
stateDiagram-v2
  [*] --> awaiting_claim_review: create + manual claim
  awaiting_claim_review --> snapshotting: user approves + start
  snapshotting --> planning: immutable snapshot persisted
  planning --> investigating: Qwen plan complete
  investigating --> challenging: evidence tasks complete
  challenging --> reinvestigating: skeptic requires more work
  reinvestigating --> judging: reinvestigation bounded
  challenging --> judging: challenges resolved
  judging --> completed: verdict issued
  judging --> completed_with_limitations: verdict with gaps
  snapshotting --> failed: terminal error
  planning --> failed
  investigating --> failed
  challenging --> failed
  judging --> failed
```

## Multi-agent pipeline

Each stage maps to a durable worker and a Qwen-backed role where reasoning is required:

| Stage | Worker | Role | Primary input |
| --- | --- | --- | --- |
| `snapshotting` | Snapshot | Repository ingest | GitHub tree + blob APIs |
| `planning` | Planning | Investigation planner | Claim + snapshot manifest |
| `investigating` | Evidence | Repository investigator | Admitted file excerpts only |
| `challenging` | Skeptic | Adversarial reviewer | Provisional evidence bundle |
| `judging` | Judge | Evidence judge | Challenges + evidence + limitations |

Human-in-the-loop happens **before** automation: the user reviews and approves the claim statement on the claims screen.

## Durable job model

PostgreSQL is the queue and source of truth. Each worker:

1. Claims one eligible job with `FOR UPDATE SKIP LOCKED`
2. Records a lease token and attempt history
3. Performs work outside the claim transaction
4. Heartbeats while running; expired leases can be reclaimed safely
5. Commits lifecycle transitions atomically with job success or failure

Snapshot identity is immutable per investigation. A replacement worker replays an existing snapshot instead of rebuilding from GitHub when one is already persisted.

## Authentication and ownership

- GitHub OAuth establishes a server-side session (HTTP-only cookie)
- Every investigation row has `owner_user_id`
- API routes enforce owner scope; cross-user ID access returns `not_found`
- Mutations require an `Idempotency-Key` header (UUID)

## Alibaba Cloud / Qwen integration

Model calls go through DashScope-compatible chat completions. The client lives at `server/qwen/client.ts` and is used by planning, evidence, skeptic, and judge services. Configure:

- `QWEN_API_KEY`
- `QWEN_API_ORIGIN` (e.g. `https://dashscope-intl.aliyuncs.com` for international)

Deployment target for the hackathon is Alibaba Cloud (ECS + RDS). The application code is cloud-agnostic; only hosting and managed PostgreSQL are Alibaba-specific.

## Frontend data flow

The UI does **not** simulate investigations. UUID-backed routes call `/api/v1/investigations/*` with credentials. The live screen polls lifecycle events every two seconds. The report screen loads the durable judge artifact after terminal completion.

`/sample-report` is a **static illustrative report** only. It does not reflect a live backend investigation.

## Key directories

| Path | Purpose |
| --- | --- |
| `app/` | Next.js routes and UI |
| `server/persistence/` | Investigation and snapshot repositories |
| `server/worker/` | Durable worker runners and job repositories |
| `server/qwen/` | DashScope client and agent services |
| `server/github/` | Immutable public snapshot ingest |
| `server/auth/` | OAuth, sessions, ownership |
| `lib/contracts/` | Shared API and domain schemas |

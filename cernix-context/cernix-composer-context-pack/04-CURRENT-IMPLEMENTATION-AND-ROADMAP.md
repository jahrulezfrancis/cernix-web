# Cernix Current Implementation and Remaining Roadmap

## Status convention

- **Merged:** reviewed and present on the default branch.
- **Current:** next implementation milestone.
- **Planned:** not implemented and must not be marketed as live.

## Merged work

### Product and design definition

- Product concept and primary users defined.
- Claim-centered verification direction defined.
- Multi-agent investigation architecture designed.
- MVP user flow designed.
- Cobalt Terminal visual direction selected.
- Frontend initially scaffolded with V0.

### Frontend investigation prototype

Implemented a frontend-only persistent lifecycle:

```text
New Investigation
→ Claim Review
→ Live Investigation
→ Evidence Report
```

Capabilities include:

- Stable investigation IDs.
- localStorage-backed repository with validation and fallback.
- Up to five selected claims.
- Persisted interpretation/criticality/exclusion edits.
- Deterministic mock workflow and agent events.
- Pause, resume, step advancement, completion, and refresh restoration.
- Investigation-specific mock reports.
- Honest not-found, incomplete-report, and demo states.
- Lifecycle-aware route guards.
- Persisted dashboard rows separated from labelled demo rows.

Important limitation: this is still a frontend prototype. It is not the authoritative backend flow.

### Backend contracts and GitHub reference parsing

Merged:

- Strict runtime boundary schemas.
- Authoritative backend lifecycle transition table.
- Safe public error definitions and envelopes.
- Hardened public GitHub repository URL parser.
- Exact host/origin/path validation.
- Extensive hostile-input regression tests.

### PostgreSQL persistence

Merged:

- PostgreSQL 17 local/CI setup.
- Investigation records.
- Manual claims.
- Lifecycle events.
- Idempotency records.
- Initial snapshot jobs.
- Transactional create/approve/start/transition behavior.
- Cursor and error hardening.
- Guarded randomized disposable integration databases.
- Strict numeric-loopback `_test` targeting.
- Extensive schema/catalog/direct-SQL/concurrency tests.

### Immutable public-GitHub snapshots

Merged:

- Constant-origin GitHub REST client.
- Exact commit/root-tree resolution.
- Deterministic recursive/BFS enumeration.
- Versioned admission policy.
- Bounded ordered blob retrieval.
- Secret/binary/unsafe-path exclusions.
- Git blob object SHA-1 verification.
- Raw and normalized SHA-256.
- Canonical manifest versioning and hashing.
- PostgreSQL snapshot, entry, and admitted-file persistence.
- Application-level immutable replay.
- Persisted replay validation tied to Git object identity.
- Versioned secret-policy evaluator.
- Offline provider fixtures and guarded PostgreSQL integration tests.

## Current milestone

### Milestone 11.5 — Investigation UI and layout polish

Goal: make backend-backed investigation screens readable, scannable, and trustworthy — not a raw data dump.

**Why now:** M11 cutover wires real data end to end, but the live and report surfaces still feel like debug views. First real investigations expose layout and hierarchy problems that block product confidence.

Deliver:

- **Live investigation** — stage timeline, grouped agent activity, human-readable event summaries (replace raw `JSON.stringify` payloads as the primary view).
- **Evidence report** — clear information hierarchy: summary → claim navigator → verdict/evidence/challenges/gaps in structured panels.
- **Claim review** — consistent form layout, status cues, and primary action prominence.
- **Investigations dashboard** — scannable rows with status, repo, and continuation links.
- **Shared layout** — consistent max-width, spacing, typography, and section headers across the investigation flow.
- **States** — loading, empty, error, and in-progress states that match Cobalt Terminal and do not look like placeholders.
- **Responsive pass** — investigation flow usable on tablet and mobile widths.

Do not block on auth or SSE. Polling-backed live view is acceptable until Milestone 13.

Use the first completed real investigation as the acceptance fixture.

## Remaining milestones

The order below is the recommended dependency order. Composer must complete and review one milestone before expanding into the next.

### Milestone 7 — Investigation planning and model adapter

Build the first Qwen-backed structured reasoning boundary.

Deliver:

- Server-only Qwen configuration and client.
- Strict request/response schemas.
- Model/prompt version persistence.
- Timeouts, retry classification, token/context limits, and safe errors.
- Durable planning jobs and attempts using the worker patterns from Milestone 6.
- Claim-to-obligation decomposition.
- Structured investigation plans persisted per selected claim.
- Offline contract/fixture tests and opt-in provider smoke.
- `planning → investigating` only after a valid complete plan exists.

Do not yet create final judgments.

### Milestone 8 — Evidence retrieval and repository investigator

Build deterministic evidence retrieval over admitted snapshot files.

Deliver:

- Snapshot-scoped lexical/symbol search.
- Bounded excerpts and citations.
- Evidence candidate schema and persistence.
- Obligation-task jobs.
- Repository investigator using Qwen only over retrieved admitted context.
- Evidence provenance: snapshot, commit, path, location, content hashes, agent/model/prompt versions.
- Gap and counterevidence capture.
- Context/token limits and secret-safe logging.
- `investigating` completion only when every planned task is terminally accounted for.

### Milestone 9 — Skeptic challenge and reinvestigation

Deliver:

- Structured provisional analyses.
- Skeptic challenge jobs.
- Challenge types and severity.
- Evidence-backed challenges.
- Resolution/response records.
- Bounded `challenging → reinvestigating → judging` loop.
- Maximum reinvestigation cycles to prevent infinite agent loops.
- Lifecycle and job idempotency.

### Milestone 10 — Judgment and durable evidence reports

Deliver:

- Structured judge input and output.
- Verdict mapping to verified/partially verified/unverified user language.
- Explainable confidence factors.
- Judgment, limitation, gap, and maintainer-action persistence.
- Immutable/versioned report artifact tied to investigation and snapshot.
- Report replay validator.
- `judging → completed | completed_with_limitations | failed`.
- No sample fixture fallback for real IDs.

### Milestone 11 — Backend API and frontend cutover

Replace localStorage authority with backend resources.

Deliver:

- Investigation create/read/list routes.
- Claim review/update route.
- Start route with idempotency.
- Event/cursor route.
- Report route.
- Strict public contracts and safe errors.
- Loading, retry, not-found, lifecycle-conflict, and unavailable states.
- Frontend flow wired end to end to PostgreSQL-backed lifecycle.
- Remove or clearly isolate mock/demo paths.
- No hardcoded “live” data.

During cutover, do not attempt to merge localStorage records into production backend records automatically. Provide an explicit demo/prototype boundary.

### Milestone 11.5 — Investigation UI and layout polish

See **Current milestone** above for the active brief. Completes before auth if the product is being demoed or tested with real investigations.

### Milestone 12 — Authentication, ownership, and abuse controls

Deliver:

- User authentication appropriate to the chosen deployment.
- Project/investigation ownership.
- Authorization on every read and mutation.
- CSRF/session/cookie protections as appropriate.
- Rate limits and request-size limits.
- Idempotency ownership.
- Audit-safe security events.
- No cross-user IDOR through route IDs.
- Secret management and environment validation.

Authentication may be moved before public API cutover if deployment exposure requires it. Do not publicly deploy mutation routes without it.

### Milestone 13 — Live progress projection

Deliver:

- Persisted event cursor.
- SSE endpoint with reconnect/resume.
- Frontend live-investigation screen driven by real lifecycle/job/agent events.
- Honest progress derived from durable tasks, not fabricated percentages.
- Polling fallback.
- No in-memory connection as source of truth.

### Milestone 14 — Deployment and operations

Deliver:

- Web and worker process deployment.
- PostgreSQL production TLS/CA verification.
- Migration release procedure.
- Worker supervision/restart.
- Health/readiness checks.
- Structured safe logs.
- Metrics for queue depth, attempts, latency, failures, lease expiry, provider usage, and report completion.
- Alerting and runbooks.
- Backup/restore policy.
- Idempotency retention and job-history retention.
- Dependency-security update plan.

Never use `rejectUnauthorized: false` as a production TLS shortcut.

### Milestone 15 — End-to-end hardening and hackathon finish

Deliver:

- Browser end-to-end tests for the complete user journey.
- Accessibility and keyboard review (build on Milestone 11.5 layout baseline).
- Final responsive and copy polish pass.
- Honest marketing/pricing/docs copy.
- Error/empty/loading state regression check.
- Demo repository and deterministic presentation scenario.
- Seed/demo strategy that cannot be confused with real investigations.
- Performance and cost review.
- Security review.
- Final README, architecture diagram, setup guide, demo video, and submission material.

## Definition of finished MVP

Cernix is MVP-complete when:

1. An authenticated user can create an investigation for a public GitHub repository.
2. The user can approve up to five claims.
3. A durable worker resolves and snapshots an exact commit.
4. Qwen produces a schema-valid investigation plan.
5. Evidence tasks inspect only admitted snapshot content.
6. The skeptic challenges provisional conclusions.
7. The judge produces bounded verdicts with limitations.
8. A durable report is tied to the exact snapshot and can be replay-validated.
9. The frontend shows real progress and the final report from backend state.
10. Authentication, authorization, rate limits, migrations, web process, and worker process operate safely in deployment.
11. CI and end-to-end tests protect the critical flow.
12. Product copy distinguishes verified evidence from model interpretation and known limitations.


# Cernix System Architecture

## Architectural stance

Cernix uses a durable orchestration core around specialized reasoning agents. PostgreSQL owns lifecycle, jobs, evidence, and reports. Agents never own authoritative state and must not transition investigations directly.

## High-level flow

```text
Frontend
  │
  ▼
Backend API and authoritative contracts
  │
  ▼
PostgreSQL investigation + selected claims + lifecycle
  │
  ▼
Durable jobs and workers
  │
  ├── GitHub snapshot service
  ├── Planner
  ├── Repository investigators
  ├── Skeptic/challenger
  └── Judge/report compiler
  │
  ▼
Evidence, challenges, judgments, report
  │
  ▼
Frontend report and investigation progress
```

## Authoritative layers

### Contracts

Boundary schemas validate external requests and public responses. TypeScript types should be inferred from runtime schemas where established. Unknown keys fail closed at external boundaries. Public errors use stable codes and fixed safe messages.

### Persistence

PostgreSQL is authoritative for:

- Investigations.
- Manual/selected claims.
- Lifecycle state and lifecycle events.
- Idempotency records.
- Snapshot jobs and future agent jobs.
- Immutable repository snapshots.
- Future plans, evidence, challenges, judgments, and reports.

The frontend localStorage repository is a prototype and must eventually be replaced by backend services. Do not attempt two-way synchronization between localStorage and PostgreSQL as a permanent architecture.

### Workers

Long-running or retryable operations happen in explicit worker processes, never automatically during Next.js import/build/render.

Workers use durable PostgreSQL jobs, leases, attempt history, retries, idempotent effects, and fenced finalization. Execution is at least once; durable effects are designed to be idempotent.

### External providers

Provider adapters are isolated behind strict contracts and safe errors. Provider messages, tokens, request bodies, and internal IDs must not leak into public data.

## Lifecycle

The merged backend lifecycle is authoritative. Conceptually:

```text
create
→ awaiting_claim_review

awaiting_claim_review
→ snapshotting | failed

snapshotting
→ planning | failed

planning
→ investigating | failed

investigating
→ challenging | failed

challenging
→ judging | reinvestigating | failed

reinvestigating
→ judging | failed

judging
→ completed | completed_with_limitations | failed
```

Terminal states:

```text
completed
completed_with_limitations
failed
```

Same-state requests may be idempotent. Terminal regressions are forbidden. Composer must use the merged transition table rather than recreating this list independently.

## Immutable repository snapshot

The merged snapshot system:

1. Validates a public `https://github.com/owner/repository` reference.
2. Requests repository metadata from a constant GitHub API origin.
3. Resolves the requested ref to one exact commit and root tree.
4. Enumerates the tree recursively or through deterministic bounded BFS when GitHub truncates the recursive tree.
5. Applies a versioned deterministic admission policy.
6. Excludes unsafe paths, dependencies, generated content, unsupported files, secrets, binaries, and limit overflows.
7. Fetches admitted blobs by trusted Git object SHA.
8. Verifies canonical base64, sizes, response identity, and Git blob SHA-1.
9. Normalizes valid UTF-8 text and computes raw/normalized SHA-256.
10. Creates a canonical versioned manifest and hash.
11. Persists snapshot, every inspected entry, admitted bodies, and a safe lifecycle event atomically.
12. Revalidates persisted bodies, Git identity, counts, normalized content, and manifest on replay.

The snapshot represents an exact commit and application-level immutable artifact. Deleting an investigation currently cascades deletion; database roles do not yet enforce permanent immutability.

## Multi-agent architecture

### Orchestrator

The orchestrator reads durable state, schedules bounded jobs, validates agent outputs, and performs authorized lifecycle transitions. It does not invent evidence.

### Planner

Input:

- Selected claims.
- Claim interpretations and qualifiers.
- Snapshot inventory/coverage.
- Available specialist capabilities.

Output:

- Verification obligations.
- Evidence tasks.
- Priority and dependency graph.
- Expected evidence types.
- Known limitations.

The plan must be structured and persisted before investigation begins.

### Repository investigator

Searches admitted snapshot content for code, configuration, tests, documentation, and cross-file relationships relevant to assigned obligations.

It returns evidence candidates and gaps. It does not issue the final judgment.

### Specialist investigators

Later specialists may focus on:

- Security and authorization.
- Testing and CI.
- Database and lifecycle integrity.
- Dependencies/supply chain.
- Architecture/documentation consistency.
- Reliability/concurrency.

Specialists use the same evidence schema and snapshot boundary.

### Skeptic/challenger

Receives provisional claim analysis and attempts to defeat it with concrete counterexamples or missing obligations.

### Judge

Receives:

- Claim and interpretation.
- Obligations.
- Evidence and counterevidence.
- Coverage and exclusions.
- Skeptic challenges.
- Investigator responses.

It returns a structured verdict, confidence rationale, limitations, and maintainer actions.

### Report compiler

Compiles validated durable artifacts into the final report. It must not create new evidence or silently strengthen judgments.

## Qwen/model boundary

Qwen is a reasoning provider, not the source of truth.

The future adapter must enforce:

- Server-only credentials.
- Strict timeouts and bounded retries.
- Model and prompt version persistence.
- Bounded context derived only from admitted snapshot content.
- Structured schema-validated outputs.
- No arbitrary tool/network access.
- No repository execution.
- No provider response/body leakage.
- Idempotent job semantics.
- Token/cost/size bounds.
- Safe handling of malformed or refused output.

Provider-specific types should not spread through domain or persistence layers.

## Evidence retrieval

The first real version should prefer deterministic lexical/symbol retrieval over premature vector infrastructure:

- Canonical path and language filters.
- Exact string/symbol search.
- Bounded excerpts.
- Import/reference relationships where safely derivable.
- Claim-obligation query terms.

Embeddings may be added later if evidence shows they materially improve recall. Any vector index must remain derived from and tied to a specific snapshot/manifest version.

## API direction

Future backend routes should expose authoritative resources, conceptually:

```text
POST   /api/v1/investigations
GET    /api/v1/investigations/:id
PATCH  /api/v1/investigations/:id/claims
POST   /api/v1/investigations/:id/start
GET    /api/v1/investigations/:id/events
GET    /api/v1/investigations/:id/report
```

Exact routes must follow merged contracts and later reviewed decisions. Mutation routes require idempotency and authentication before production exposure.

## Streaming direction

Persisted lifecycle/agent events are authoritative. SSE can project new events to the UI after the backend flow works. The database event cursor must support reconnect/resume. Do not treat an in-memory WebSocket connection as the source of truth.

## Security boundaries

- Constant origins for external APIs.
- No caller-controlled connection strings or arbitrary URLs at provider clients.
- No provider credentials in public errors or logs.
- No secrets or unsafe files in snapshot bodies.
- No repository execution.
- PostgreSQL transactions and constraints enforce durable ownership.
- Lease fencing prevents stale workers from mutating current work.
- Agent output is untrusted until schema-validated.
- Evidence citations must refer to admitted snapshot content.
- Frontend route parameters never authorize access by themselves.


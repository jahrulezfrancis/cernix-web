# Cernix Milestone 6 — Durable Snapshot Job Orchestration

Implement the next Cernix backend milestone: a durable PostgreSQL-backed worker that claims queued repository-snapshot jobs, runs the immutable GitHub snapshot service, recovers safely from crashes, retries classified transient failures, and advances successful investigations from `snapshotting` to `planning`.

This milestone connects already-merged components. Inspect the actual repository before implementing; do not recreate contracts or assumptions that already exist.

## Product outcome

After an investigation is started, its existing queued snapshot job can be processed by a real worker:

```text
queued
→ leased by one worker
→ immutable GitHub snapshot build/replay
→ succeeded and investigation moves snapshotting → planning
```

Transient failure:

```text
leased
→ retry_wait
→ leased again after available_at
```

Terminal or exhausted failure:

```text
leased
→ failed
→ investigation moves snapshotting → failed
```

Worker crash or lost process:

```text
leased
→ lease expires
→ another worker safely reclaims it
```

Execution is **at least once**, while durable effects are idempotent and fenced:

- One immutable repository snapshot per investigation.
- One successful lifecycle advance to `planning`.
- Stale workers cannot finalize after losing their lease.
- A replayed snapshot lets a replacement worker finish without another GitHub build.

## Scope boundaries

Implement only durable snapshot-job orchestration.

Do not add:

- Frontend changes.
- Public API routes.
- Authentication or authorization.
- Qwen integration.
- Investigation, skeptic, judge, or evidence agents.
- Planning logic beyond advancing lifecycle to `planning`.
- Retrieval or embeddings.
- Private GitHub repository support.
- Repository checkout, build, import, dependency installation, or execution.
- Redis, Kafka, RabbitMQ, SQS, BullMQ, Temporal, or another queue system.
- Cloud deployment configuration.
- Cron configuration.
- Hosted worker deployment.
- Metrics infrastructure.
- Email, webhook, SSE, or WebSocket delivery.

PostgreSQL remains the durable queue and source of truth.

## Git workflow

The Milestone 5 PR has been merged.

1. Verify the current worktree is clean.
2. Fetch the intended remote without rewriting history.
3. Switch to the repository's real default branch.
4. Fast-forward it to the merged remote default branch.
5. Run baseline typecheck, unit tests, database migration, guarded integration tests, and production build using the established safe local setup.
6. Create:

```text
feat/snapshot-worker-orchestration
```

7. Do not work on the old merged feature branch.
8. Do not rebase, squash, or rewrite published history.
9. Do not push, deploy, open a pull request, or merge.

If the worktree is dirty, the default branch cannot fast-forward, the merged Milestone 5 code is absent, or the guarded PostgreSQL target is unavailable, stop and report the exact blocker. Never discard user changes.

## Inspect before designing

Read at minimum:

- Backend lifecycle contracts and transition table.
- Investigation persistence repository.
- Existing `snapshot_jobs` migration, types, indexes, constraints, and creation path.
- Lifecycle event schemas and insertion behavior.
- Database singleton and transaction helpers.
- Database error classifier.
- Disposable integration-test database guard.
- Repository snapshot service and factory.
- Persisted snapshot repository and replay validation.
- CI workflow and package scripts.
- README limitations and environment documentation.

Use existing authoritative types, limits, errors, and transition rules. Do not create a second lifecycle state machine.

## 1. Durable job-state model

Add a new migration after the merged snapshot migration. Do not modify any merged migration.

Use the next real migration number discovered in the repository. The description below calls it migration 003 for clarity.

Evolve `snapshot_jobs` into an explicit durable state machine.

Required statuses:

```text
queued
leased
retry_wait
succeeded
failed
cancelled
```

State meanings:

- `queued`: ready for an initial claim when `available_at <= database now`.
- `leased`: owned temporarily by one worker attempt.
- `retry_wait`: transient failure scheduled for a later claim.
- `succeeded`: snapshot exists and investigation has atomically reached at least `planning` through this job.
- `failed`: retry budget exhausted or a terminal failure atomically moved the investigation to `failed`.
- `cancelled`: job became obsolete because authoritative investigation state makes execution invalid; it is not an execution failure.

Add or normalize bounded columns equivalent to:

```text
status
attempt_count
max_attempts
available_at
lease_owner
lease_token
lease_expires_at
last_heartbeat_at
started_at
completed_at
failed_at
failure_code
created_at
updated_at
```

Reuse existing columns if semantically correct. Do not add duplicates under new names.

Recommended types:

- UUID job ID if already established.
- Integer attempts.
- `timestamptz` timestamps.
- Bounded lowercase machine-safe failure code.
- Bounded opaque worker owner string.
- UUID lease token generated independently for every claim.

Use database time (`CURRENT_TIMESTAMP`/`transaction_timestamp()`) for lease eligibility, lease expiry, and persisted transitions. Do not trust worker wall-clock time for ownership decisions.

### State coherence constraints

Add explicit named CHECK constraints proving at least:

- `attempt_count >= 0`.
- `max_attempts` is within a conservative supported range and `attempt_count <= max_attempts`.
- `available_at` is present.
- `queued` and `retry_wait` have no lease owner/token/expiry/heartbeat.
- `leased` has lease owner, token, expiry, heartbeat/start state, no completion/failure timestamp, and `attempt_count >= 1`.
- `succeeded` has `completed_at`, no active lease, and no failure code/timestamp.
- `failed` has `failed_at`, a safe failure code, no active lease, and no completion timestamp.
- `cancelled` has a terminal timestamp or clearly named cancellation timestamp, no active lease, and an allowed safe cancellation code/reason.
- Terminal states cannot return to active states.
- Failure codes match a bounded lowercase machine-code pattern and never contain provider text.
- Worker owner values are bounded and contain no whitespace/control characters or secrets.
- Lease expiry is after the heartbeat/claim time.
- Timestamps are coherent with creation/start/completion.

Name every new constraint explicitly and test the catalog.

### Active-job uniqueness

Maintain at most one active snapshot job per investigation across:

```text
queued
leased
retry_wait
```

Update the existing partial unique index safely. Historical `succeeded`, `failed`, or `cancelled` jobs may coexist only if the product's existing creation semantics require history; do not allow accidental duplicate active work.

Backfill existing queued rows safely:

- Preserve job and investigation IDs.
- Preserve creation timestamps.
- Set `attempt_count = 0`.
- Set a bounded persisted default `max_attempts`.
- Set `available_at` to an existing relevant timestamp or migration time.
- Keep them claimable.

Migration must work against populated Milestone 5 data.

## 2. Durable attempt history

Add a `snapshot_job_attempts` table so claim/retry/failure history is durable and auditable without overloading lifecycle events.

Suggested fields:

```text
id                  BIGINT GENERATED ALWAYS AS IDENTITY
job_id              UUID NOT NULL
investigation_id    UUID NOT NULL
attempt_number      INTEGER NOT NULL
lease_token         UUID NOT NULL
worker_owner        bounded text NOT NULL
status              leased | succeeded | retry_scheduled | failed | lease_expired | cancelled
started_at          timestamptz NOT NULL
last_heartbeat_at   timestamptz NOT NULL
finished_at         timestamptz NULL
failure_code        bounded safe code NULL
next_available_at   timestamptz NULL
```

Requirements:

- Foreign keys preserve job/investigation ownership.
- Deleting an investigation/job cascades attempt history consistently with existing product deletion semantics.
- Unique `(job_id, attempt_number)`.
- Unique lease token.
- Status/timestamp/failure/next-availability coherence is database-constrained.
- Attempts are append-on-claim and terminally updated only by the matching lease.
- Never store raw provider errors, repository URLs, tokens, file paths, file content, response bodies, SQL, stack traces, hostnames, container IDs, or process command lines.

Do not add heartbeat rows repeatedly. Update the current attempt's bounded heartbeat timestamp.

## 3. Authoritative queue repository

Create a focused server-side snapshot-job repository. Keep SQL and state transitions centralized.

Provide operations equivalent to:

```text
claimNext(options)
heartbeat(jobId, leaseToken, leaseDuration)
completeSuccess(jobId, leaseToken)
scheduleRetry(jobId, leaseToken, failureCode, availableAt)
completeFailure(jobId, leaseToken, failureCode)
cancel(jobId, leaseToken or unleased authority, reasonCode)
getJob(jobId)
```

Use precise result objects rather than ambiguous null/throw behavior. Results should distinguish:

- Claimed/updated.
- Nothing eligible.
- Idempotent already-terminal result.
- Lease lost/stale token.
- Investigation/job not found.
- Authoritative lifecycle conflict.

### Claim algorithm

Claim in one short PostgreSQL transaction.

Use row locking with semantics equivalent to:

```sql
FOR UPDATE SKIP LOCKED
```

Eligibility:

- `queued` with `available_at <= database now`.
- `retry_wait` with `available_at <= database now`.
- `leased` with `lease_expires_at <= database now` for crash recovery.

Order deterministically by:

1. `available_at` ascending.
2. `created_at` ascending.
3. Stable job ID ascending.

On claim:

1. Lock one eligible job.
2. Lock/load its investigation.
3. Reconcile any previous expired attempt.
4. Verify whether work is still authoritative.
5. Increment `attempt_count` exactly once.
6. Generate a new UUID lease token.
7. Set `leased`, owner, heartbeat, and expiry using database time.
8. Insert the attempt row atomically.
9. Return the persisted claim.

If an expired lease is reclaimed:

- Mark the previous attempt `lease_expired` with safe timestamps/code.
- Never let the old token update job or attempt afterward.
- Increment the attempt number only for the new claim.

If attempt budget is already exhausted when a job becomes eligible, do not issue another lease. Atomically terminally fail it through the same authoritative failure path.

### Lifecycle reconciliation at claim

Handle durable states honestly:

- Investigation `snapshotting`, no snapshot: claim normally.
- Investigation `snapshotting`, snapshot already exists: claim or reconcile through a no-network success finalization path; do not rebuild.
- Investigation already `planning` or a valid later nonterminal state, snapshot exists: mark the job `succeeded` idempotently if this job is the authoritative snapshot job.
- Investigation terminal `failed`: mark active job `cancelled` or reconcile to `failed` according to one documented rule without regressing lifecycle.
- Investigation completed/later terminal: cancel obsolete active work; never regress.
- Investigation missing: follow foreign-key reality and return not found safely.
- Snapshot absent but investigation already beyond `snapshotting`: treat as an integrity conflict; do not fabricate success.

Reuse the authoritative lifecycle transition table. Do not add illegal shortcuts.

## 4. Lease fencing and heartbeats

Every mutation by a worker after claim must require:

```text
job_id matches
status = leased
lease_token matches
lease has not expired according to database time
```

Where relevant also verify attempt number/current attempt ownership.

A stale worker must be unable to:

- Extend the new worker's lease.
- Mark the job succeeded.
- Schedule a retry.
- Fail or cancel the job.
- Update the current attempt.
- Advance or fail the investigation.

Heartbeat behavior:

- Extends from database time, not from the previous expiry.
- Updates job and current attempt atomically.
- Returns an explicit lease-lost result if token/state/expiry no longer matches.
- Never resurrects expired or terminal work.
- Does not emit lifecycle events or append heartbeat history.

Use a lease duration comfortably beyond one heartbeat interval. Validate configuration so:

```text
heartbeat interval < lease duration / 2
```

or enforce an equivalently safe margin.

## 5. Worker execution core

Create a dependency-injected worker core that can process one claim at a time. Multiple processes provide horizontal concurrency; do not add complex in-process concurrency in this milestone.

Suggested modules, adapted to repository conventions:

```text
server/worker/snapshot-job-repository.ts
server/worker/snapshot-worker.ts
server/worker/retry-policy.ts
server/worker/worker-config.ts
server/worker/run-snapshot-worker.ts
```

The core should support:

```text
runOnce(signal)
runLoop(signal)
```

### Per-job execution

1. Claim one job.
2. If none is eligible, return an idle result.
3. Start a heartbeat loop tied to the claim.
4. Call the existing repository snapshot service for the investigation.
5. Pass a composed cancellation signal if the service supports one; extend the existing service signature minimally if required.
6. If heartbeat reports lease loss, abort local snapshot work and forbid finalization.
7. On valid snapshot success, atomically finalize success and lifecycle transition.
8. On failure, classify it and atomically retry or terminally fail while the lease is still valid.
9. Always stop heartbeat timers/listeners and settle them.

Never hold a database transaction open during GitHub requests, backoff sleeps, or snapshot verification.

### Success transaction

In one transaction:

1. Lock the leased job and verify current unexpired token.
2. Lock the investigation.
3. Load/verify that the immutable snapshot exists for that investigation.
4. If investigation is `snapshotting`, transition it to `planning` using the authoritative lifecycle rule.
5. Mark the current attempt `succeeded`.
6. Mark the job `succeeded` and clear lease fields.
7. Insert the existing safe lifecycle transition event or the repository's authoritative equivalent.

The snapshot-persisted event already exists; do not duplicate it.

Idempotent success:

- If the job is already succeeded and investigation is already at `planning` or later valid state, return the durable success result.
- Never emit duplicate lifecycle transitions/events.

### Retry transaction

For a retryable failure while lease is valid:

1. Lock/verify job and token.
2. Mark current attempt `retry_scheduled` with safe failure code and next availability.
3. Set job to `retry_wait`.
4. Set `available_at` to the persisted next time.
5. Clear all lease fields.
6. Keep investigation in `snapshotting`.

Do not create a new job row for a retry.

### Terminal failure transaction

For terminal failure or exhausted attempts:

1. Lock/verify job and token, or use a safe exhausted-before-claim path.
2. Lock investigation.
3. If investigation is still `snapshotting`, transition to `failed` through the authoritative lifecycle rule with a safe bounded failure code.
4. Mark attempt `failed`.
5. Mark job `failed`, clear lease fields, and persist failure timestamp/code.
6. Insert the existing safe lifecycle failure/transition event.

Never put provider messages, repository data, secrets, URLs, tokens, response bodies, paths, SQL, or stacks in job, attempt, investigation, or event failure fields.

If lifecycle already advanced legitimately, reconcile without regression and classify the job honestly.

## 6. Retry policy

Centralize retry classification and scheduling. Do not scatter error-code checks across worker code.

Start from the existing `ApplicationError` and safe GitHub/database classifications.

Recommended classification:

### Retryable

- `dependency_unavailable` caused by GitHub/network/provider availability.
- `rate_limited`.
- Explicit transient timeout/service-unavailable codes already used internally.
- Worker shutdown/interruption while the lease is still owned.

### Terminal

- Invalid repository URL/reference.
- Repository private, disabled, archived, or over policy limits.
- Ref not found or empty repository where product rules make it invalid.
- Unsafe/malformed persisted investigation input.
- Unsupported policy/manifest version.
- Lifecycle conflict that cannot be reconciled.
- Deterministic repository policy rejection.

### Internal/unknown

Use a conservative bounded retry rule:

- Retry unknown/internal failures only if explicitly approved by a small policy and within the maximum attempts, or fail terminally to avoid infinite poison jobs.
- Document the chosen behavior.
- Never inspect arbitrary error-message text to classify.

Persist only a stable allowlisted `failure_code`. Keep private causes non-enumerable/in memory only.

### Backoff

Use persisted exponential backoff with bounded jitter or a deterministic bounded schedule.

Suggested defaults:

```text
max attempts: 4
base delay: 5 seconds
maximum delay: 5 minutes
```

Requirements:

- Attempt number is persisted and drives the delay.
- No negative, fractional, infinite, `NaN`, or overflowing delay.
- Cap is enforced.
- Tests inject randomness/time if jitter is used.
- `available_at` is persisted before lease release.
- Process restart does not reset the delay.
- Configuration changes do not retroactively change a job's persisted `max_attempts`.

## 7. Worker configuration

Add lazy server/worker-only environment parsing with strict bounds.

Use names consistent with project conventions, equivalent to:

```text
CERNIX_SNAPSHOT_WORKER_OWNER
CERNIX_SNAPSHOT_LEASE_SECONDS
CERNIX_SNAPSHOT_HEARTBEAT_SECONDS
CERNIX_SNAPSHOT_POLL_MS
CERNIX_SNAPSHOT_MAX_ATTEMPTS
CERNIX_SNAPSHOT_RETRY_BASE_SECONDS
CERNIX_SNAPSHOT_RETRY_MAX_SECONDS
```

Guidelines:

- Generate an opaque UUID-based owner at process start if no owner is supplied.
- Do not default to hostname, username, container ID, or command line.
- Bound owner length and characters.
- Lease duration: conservative range such as 30–900 seconds.
- Heartbeat: positive and safely below lease duration.
- Polling: conservative range such as 250–30,000 ms.
- Attempts: 1–10.
- Retry base/max: positive, bounded, and coherent.
- Invalid configuration fails before polling/claiming.
- Never log environment values or database/GitHub credentials.
- Importing modules during Next build must not start a worker or require worker environment.

Update `.env.example` and README with safe examples only. Do not add a real `.env`.

## 8. CLI runner and graceful shutdown

Add an explicit worker command. It must never start automatically inside the Next.js web process or production build.

Suggested package commands:

```text
worker:snapshot
worker:snapshot:once
```

Use the repository's TypeScript execution convention; add no large worker framework.

Runner requirements:

- `--once` processes at most one claim and exits with a meaningful code.
- Loop mode polls when idle using an abortable sleep.
- `SIGINT` and `SIGTERM` stop new claims.
- Graceful shutdown aborts active GitHub work.
- If the lease is still valid, interrupted work is safely released to immediate or bounded `retry_wait` with an allowlisted shutdown code.
- If lease is lost, the process performs no job/lifecycle mutation.
- Timers and signal listeners are cleaned up.
- Database pool closes once on exit.
- No `process.exit()` from reusable library modules.
- CLI logs only safe operational fields:
  - job ID
  - investigation ID
  - attempt number
  - safe status
  - safe failure code
  - bounded duration/counts if available
- Never log repository content, file paths, repo URL/ref, token, authorization headers, database URL, provider body/message/request ID, SQL, stack, or environment values.

Use an injected logger in the worker core so tests can assert safe output.

## 9. Events and lifecycle integrity

Reuse existing lifecycle event variants where they accurately represent:

- `snapshotting → planning`.
- `snapshotting → failed`.

Do not create noisy heartbeat/lease lifecycle events.

Attempt history is the operational audit log for claims, retries, expiration, and completion.

If existing event schemas cannot represent the two lifecycle outcomes safely, add only the smallest strict event variants in migration/contracts. Event payloads must be bounded, versioned/strict, and contain no raw failure/provider data.

All lifecycle transitions must use the authoritative backend transition table:

```text
snapshotting → planning
snapshotting → failed
```

Same-state requests may be idempotent. Illegal transitions and terminal regressions fail closed.

## 10. Database and public error handling

Preserve the existing safe `ApplicationError` boundary.

- Existing `ApplicationError` instances remain safe and classified.
- PostgreSQL dependency errors remain `dependency_unavailable`.
- Unknown SQLSTATE/constraint errors remain `internal_error`.
- Lease-lost is an internal orchestration outcome, not a public provider error.
- Constraint names, SQL, database URL, host, user, password, worker owner, lease token, provider details, stack, and causes never enter public JSON.
- Lease tokens should not enter ordinary logs or lifecycle events.

Use exact named-constraint checks where race recovery is needed. Never catch every `23505` as the same condition.

## 11. Unit tests

All normal unit tests must be deterministic, offline, and require no PostgreSQL, GitHub token, or live network.

Cover at minimum:

### Configuration

- Defaults.
- Every minimum/maximum boundary.
- Invalid numeric syntax.
- Negative, zero, fraction, exponent, `NaN`, infinity, and overflow.
- Heartbeat/lease incoherence.
- Invalid owner characters/length.
- Lazy import with no environment access during unrelated build/tests.

### Retry policy

- Every known retryable and terminal code.
- Unknown error policy.
- Attempt 1 through maximum.
- Exhaustion.
- Backoff cap.
- Injected jitter/time determinism.
- No message-text classification.

### Worker core

- Idle `runOnce`.
- Claim → heartbeat → snapshot → success.
- Existing snapshot replay success with no new GitHub build.
- Retryable failure schedules one retry.
- Terminal failure fails job/investigation.
- Exhausted attempt fails without another snapshot call.
- Heartbeat lease loss aborts and prevents finalization.
- Stale completion/retry/failure cannot mutate.
- Shutdown before claim.
- Shutdown during snapshot.
- Shutdown during idle sleep.
- Timer/listener cleanup.
- Logger field allowlist and secret non-disclosure.
- No unhandled rejections from heartbeat/snapshot races.

Use injected repository, snapshot service, time/sleep, UUID, logger, and signals. Do not use real delays.

## 12. PostgreSQL integration tests

Use only the existing guarded disposable child-database harness. Preserve its refusal behavior and cleanup guarantees.

Migration/catalog coverage:

- Populated migration from the merged schema.
- Every new/changed job column, type, nullability, default, and bound.
- Every named CHECK constraint.
- Active-job partial unique predicate.
- Attempt table identity, uniques, ownership FKs, cascades, and checks.
- Up → populated use → down behavior according to the repository's migration policy → up again.
- Legacy queued jobs remain claimable after migration.

Direct SQL rejection:

- Every invalid status/lease/timestamp combination.
- Attempt count underflow/overflow and greater than max.
- Unsafe owner/failure codes.
- Lease without token/owner/expiry.
- Terminal state retaining a lease.
- Invalid attempt status/timestamps.
- Duplicate attempt number/token.
- Cross-job/investigation attempt ownership.
- Duplicate active jobs.

Transactional behavior:

- Two workers claiming concurrently receive different jobs.
- Ten workers racing for one job produce one lease and one attempt row.
- Claim order is deterministic.
- Retry is not claimable before `available_at`.
- Retry becomes claimable after controlled/database-time expiry.
- Expired lease is reclaimed once; prior attempt becomes `lease_expired`.
- Old token cannot heartbeat/succeed/retry/fail after reclamation.
- New token can finish.
- Heartbeat extends a live lease but cannot revive an expired lease.
- Attempt increments exactly once per claim.
- Maximum-attempt exhaustion is terminal and creates no extra lease.
- Success atomically marks attempt/job and transitions investigation to `planning` with one lifecycle event.
- Failure atomically marks attempt/job and transitions investigation to `failed` with one lifecycle event.
- Retry keeps investigation `snapshotting` and clears lease.
- Injected constraint failure rolls back job, attempt, lifecycle, and event changes.
- Existing snapshot lets replacement worker finalize without rebuilding.
- Worker crash simulated by expired lease recovers safely.
- Stale worker completing after replacement cannot change durable state.
- Repeated success/failure calls are idempotent or explicitly rejected without duplicates.
- Terminal investigations cannot regress.
- Investigation deletion/cascade remains coherent.

Use direct timestamp updates only inside disposable-test setup when needed to avoid real sleeping. Production eligibility must still use database time.

## 13. CI

Keep the established CI order:

```text
npm ci
npm run typecheck
npm test
npm run db:migrate
npm run test:integration
npm run build
```

Worker unit tests join normal offline tests. PostgreSQL worker integration joins the guarded integration command.

Do not start the worker loop in CI. If testing the CLI, use `--once` with injected/fake dependencies or a focused test command that cannot poll indefinitely.

Build must receive no database, worker, destructive-test, or GitHub credential environment.

## 14. Documentation

Update README and `.env.example` to document:

- PostgreSQL-backed at-least-once job execution.
- Lease ownership and expiry recovery.
- Fenced finalization.
- Retry policy and persisted attempt budget.
- Successful `snapshotting → planning` transition.
- Terminal `snapshotting → failed` transition.
- Worker commands for local use.
- Graceful shutdown behavior.
- Safe configuration names and ranges.
- Operational logs contain identifiers/status codes only.
- The worker must run as a separate process in future deployment.
- Deployment/supervision, distributed metrics, and alerts remain deferred.

Do not claim exactly-once execution. State that effects are idempotent/fenced while execution is at least once.

## 15. Security and destructive-safety requirements

- Never print or commit `DATABASE_URL`, `GITHUB_TOKEN`, authorization values, lease tokens, passwords, provider bodies, request IDs, raw errors, repository contents, or file paths.
- Never accept a database target outside the existing numeric-loopback `_test` guard for integration.
- Never drop/truncate the base test database.
- Create/drop only randomized disposable child databases through the established harness.
- No real `.env`.
- No Docker socket/system changes.
- No live GitHub request in normal tests.
- Do not run repository code.
- Do not use worker-owner or lease-token values as authorization outside the precise database fencing checks.

## 16. Verification

Run baseline before implementation and final checks afterward.

Required final checks:

```text
npm run typecheck
npm test
```

Run integration once without destructive opt-in and prove it refuses before pool construction.

Then, only with the established validated local `_test` URL and explicit opt-in:

```text
npm run db:migrate
npm run test:integration
```

Then:

```text
npm run build
git diff --check
docker compose config --quiet
npm audit
npm audit --omit=dev
```

Also verify:

- No disposable child database before integration.
- No disposable child database after integration.
- Base `_test` database remains intact.
- No worker process remains running after tests.
- No live GitHub request occurred.
- Optional GitHub smoke remains opt-in and safely skipped.
- No credential/provider/environment/database/generated artifact entered the diff.
- Worktree is clean after commits.

Audit is read-only. Do not apply forced or unrelated dependency remediation.

## 17. Commit structure

Create focused commits after all checks pass. Suggested structure:

```text
feat: add durable snapshot job orchestration
test: verify leased snapshot worker recovery
```

One implementation commit plus one test/hardening commit is preferred if the split is honest. Do not manufacture a split by moving required implementation pieces into a test commit.

Do not amend merged history. Do not push.

## Required final response

Return a detailed Markdown implementation report with exactly these top-level sections:

```text
# Outcome
# Branch and Commits
# Files Changed
# Job State Machine and Migration
# Claiming and Lease Fencing
# Worker Execution and Shutdown
# Retry and Failure Policy
# Lifecycle and Event Integration
# Tests and Concurrency Proof
# Verification Results
# Dependency and Audit Report
# Deviations and Remaining Limitations
# Final Git State
```

The report must include:

- Actual base/merge base and complete branch history.
- Every created/modified file with purpose.
- Exact job and attempt status sets.
- Migration/backfill behavior.
- Every job-state coherence constraint and active-job uniqueness rule.
- Claim SQL/locking order and deterministic eligibility order.
- Exact lease fencing predicate.
- Lease duration/heartbeat/default configuration.
- Expired-lease recovery semantics.
- Success, retry, terminal failure, cancellation, and idempotent replay transactions.
- Exact retryable/terminal classification and backoff formula.
- Graceful shutdown behavior.
- Lifecycle transitions/events emitted.
- Unit/integration test counts and concurrency scenarios.
- Results of every required command.
- Integration refusal result without opt-in.
- Child database counts before/after.
- Whether any worker or live request remained/runs.
- Dependencies and exact audit delta.
- Complete diff statistics against updated `main`.
- Final `git status --short --branch`.
- Explicit confirmation nothing was pushed or submitted as a PR.
- Remaining limitations separated from unresolved defects.

If safe lease fencing, atomic lifecycle finalization, or guarded database testing cannot be achieved within this scope, stop and report the blocker rather than weakening the guarantee.

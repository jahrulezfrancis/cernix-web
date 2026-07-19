# Cernix

## Backend database development

The persistence slice uses PostgreSQL 17. All checked-in credentials are demo-only
and bind only to the local loopback interface.

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://cernix_demo:cernix_demo@127.0.0.1:54329/cernix_test
export CERNIX_INTEGRATION_TEST_DATABASE=1
npm run db:migrate
npm run test:integration
docker compose stop postgres
```

Use `npm run db:rollback` to roll back one migration during development. Migrations
never execute during import or application builds.

Integration tests refuse to connect unless the explicit opt-in is exactly `1`, the
URL uses the numeric `127.0.0.1` host with no query string or fragment, and the
configured base database name ends in `_test`. The harness reconstructs an explicit
PostgreSQL configuration object rather than passing the URL to the driver. Rootless
Docker port forwarding means PostgreSQL reports internal bridge addresses even though
the validated client endpoint is numeric loopback; `current_database()` must also
match the guarded base before child creation.
Each run creates a randomized child database, migrates it from empty, and drops only
that exact child database during cleanup.
Job execution, retry scheduling, and production deployment are intentionally deferred.

## Immutable public GitHub snapshots

An investigation in `snapshotting` can be ingested as one immutable repository
snapshot. Cernix starts from the persisted, validated owner/repository, reads public
metadata from `https://api.github.com`, resolves the requested ref (or canonical
default branch) to an exact 40-character commit SHA, and resolves that commit's exact
root tree SHA. The mutable ref is recorded as context; snapshot identity always uses
the commit and tree object IDs.

All requests use the platform `fetch` implementation, `redirect: "manual"`, a stable
Cernix user agent, `Accept: application/vnd.github+json`, and the pinned
`X-GitHub-Api-Version: 2026-03-10` header. Client methods accept validated components,
not URLs. An optional `GITHUB_TOKEN` is attached only to this constant API origin and
is never put in errors, events, snapshots, fixtures, hashes, or logs. Private,
archived, disabled, and GitHub-reported repositories over 100 MiB are rejected.

The tree API is first read recursively. A truncated result is discarded and replaced
with deterministic, non-recursive breadth-first traversal from the trusted root tree
SHA; fallback requests omit the `recursive` parameter entirely. Entry count, depth,
request count, per-request time, overall deadline, response bytes, file count, file
bytes, total bytes, line count, and blob concurrency are bounded. Retry is limited to
two attempts for 429, classified secondary-rate-limit 403 responses, retryable 5xx,
timeouts, and verified transient network failures. Retry delay never resets the shared
deadline or request counter.

Recursive and fallback traversal use the same path-depth rule. Repeated tree objects
are validated once and mounted independently at every prefix, while an ancestor cycle
fails the snapshot.

Admission policy version 1 excludes trees, symlinks, submodules, unsafe paths,
generated/cache/build directories, dependency/vendor directories, secret-bearing
paths, lockfiles, minified bundles, source maps, unsupported binary/media/archive/
compiled/database file types, and candidates beyond configured file/count/byte
limits. Lockfiles are deliberately excluded in this one-claim policy; future
dependency-version claims need a separate policy mode.

Admitted candidates are downloaded only by trusted tree blob SHA. Cernix strictly
decodes GitHub's base64 representation, checks reported and actual sizes, recomputes
Git's `SHA-1("blob " + byteLength + NUL + rawBytes)` object identity, and computes a
SHA-256 digest over raw bytes. Text must be strict UTF-8 and non-binary. High-confidence
private-key, GitHub token, AWS key, and narrowly formatted credential signatures are
excluded before any body is persisted. CRLF and lone CR become LF; normalized UTF-8
gets its own SHA-256 and a line count where an empty file has zero lines and a trailing
newline does not create an extra line.

Any provider representation, size, or Git-object identity inconsistency aborts the
whole snapshot; it is never persisted as a file exclusion. Deterministic exclusions
apply only after coherent bytes are verified. Blob work uses a bounded sliding window
and consumes results in canonical UTF-8 path order. The admitted-byte limit bounds
retained admitted raw content, while the completion window adds at most approximately
`blob concurrency × per-file bytes` plus bounded decoding/protocol overhead. When an
unknown-size file does not fit the remaining total, its body is discarded immediately;
later canonical files are still considered. Git LFS pointers represent pointer text,
not the separately stored LFS object.

Manifest schema version 1 uses fixed-order JSON fields, explicit nulls, UTF-8 byte-wise
path sorting, UTF-8 encoding, and exactly one final LF. Its SHA-256 excludes timestamps,
database IDs, request IDs, rate metadata, and every other nondeterministic operational
value. Offline synthetic fixtures prove source-response order independence and
sensitivity to content and decision changes. Normal CI makes no GitHub request and
needs no token.

Migration `002_repository_snapshots` stores exactly one snapshot per investigation,
every inspected entry, bodies only for admitted files, precision-safe PostgreSQL
`BIGINT` values as TypeScript strings, and one bounded
`repository_snapshot_persisted` event at stage `snapshotting`. Artifact construction
finishes before the short transaction. The transaction locks and rechecks the
investigation, inserts the complete snapshot atomically, and returns a concurrent
winner on replay. It does not consume the queued job or advance lifecycle state.

PostgreSQL uses a decision-qualified foreign key so only an `admitted` entry in the
same snapshot can own a body. Cross-row counts, body/hash/text/line coherence, manifest
order, supported versions, and the reconstructed canonical manifest hash are also
validated by one bounded set-based loader before every replay or downstream return.
This cross-row verification is application-enforced; snapshot immutability is likewise
application-level, and deleting an investigation still cascades its snapshot. Rolling
migration 002 down deliberately deletes snapshot data and
`repository_snapshot_persisted` events while preserving all legacy investigation
events so the migration-001 event constraint can be restored coherently.

Repository source is never cloned, checked out, materialized to repository paths,
built, installed, imported, or executed.

### Snapshot configuration defaults

| Setting | Default | Conservative maximum |
|---|---:|---:|
| Authenticated / anonymous requests | 2,000 / 50 | 5,000 |
| Inspected entries | 10,000 | 50,000 |
| Admitted files | 1,500 | 5,000 |
| Bytes per file | 256 KiB | 1 MiB |
| Total admitted bytes | 10 MiB | 50 MiB |
| Lines per file | 20,000 | 100,000 |
| Tree depth | 64 | 128 |
| Request timeout | 10 seconds | 60 seconds |
| Snapshot deadline | 90 seconds | 300 seconds |
| Blob concurrency | 4 | 16 |

Configuration is read lazily by the server service factory, not during module import,
client bundling, static generation, or ordinary unit tests. See `.env.example` for the
complete variable list.

An optional read-only live smoke is excluded from normal tests and CI. It runs only
when `CERNIX_GITHUB_LIVE_SMOKE=1` and `GITHUB_LIVE_OWNER`,
`GITHUB_LIVE_REPOSITORY`, and an exact 40-character `GITHUB_LIVE_COMMIT` are all set:

```bash
npm run test:github-live
```

## Deferred persistence policies

- Idempotency retention and expiry are not implemented.
- The repository exposes append-only investigation events, but database-role or
  trigger-level prevention of event updates/deletes is deferred.
- PostgreSQL verifies that qualifiers are an array; runtime validation enforces the
  per-element constraints and maximum count.
- Production Alibaba RDS TLS and CA verification must be configured before deployment.
  Never use `rejectUnauthorized: false`.
- Job retry states and status expansion require a later migration.
- Private repositories, GitHub App authentication, object-storage offload, retention,
  dependency-claim policy modes, worker execution, and database-role-level snapshot
  immutability are deferred. Investigation cascade deletion remains supported, so the
  database role does not yet make snapshot rows absolutely undeletable.

# Cernix Engineering Operating Rules for Composer

## Core instruction

Act as a careful implementation engineer working inside an already hardened repository. Preserve reviewed invariants. Inspect before changing. Complete one bounded milestone at a time.

## Repository-first workflow

For every milestone:

1. Verify branch, `HEAD`, merge base, remote state, and worktree.
2. Require a clean worktree before switching or branching.
3. Update the real default branch using fast-forward only.
4. Run baseline quality gates.
5. Create one dedicated feature branch.
6. Inspect relevant production code, tests, migrations, and surrounding contracts.
7. Write a short internal implementation plan.
8. Implement the smallest coherent vertical slice.
9. Add unit and real integration coverage proportional to risk.
10. Run all quality gates.
11. Inspect the complete diff and `git diff --check`.
12. Create focused commits.
13. Leave the branch unpushed unless explicitly authorized.
14. Return a detailed implementation report.

Never discard a dirty worktree. Generated `next-env.d.ts` changes should be reported so the user can restore them; do not silently overwrite them.

## Source-of-truth order

When making a decision, use:

1. Merged runtime contracts and migrations.
2. Merged production behavior and tests.
3. Current milestone prompt.
4. This context pack.
5. Older frontend mock behavior.

Do not weaken backend truth to preserve a prototype convenience.

## Branch and history rules

- One branch per milestone.
- Branch from updated default branch.
- Fast-forward pulls only.
- No force push.
- No rebase or squash of published history without explicit authorization.
- No push, PR, merge, or deployment unless requested.
- Do not mix unrelated fixes into a milestone.
- Keep commits reviewable and honestly scoped.

## File and dependency discipline

- npm is canonical.
- `package-lock.json` is the only lockfile.
- Do not introduce pnpm/yarn/bun lockfiles.
- Add dependencies only when existing platform APIs or current packages cannot safely solve the problem.
- Explain every production dependency.
- Do not run `npm audit fix` automatically.
- Do not commit real `.env`, logs, coverage, build output, database files, provider bodies, or secrets.
- Do not edit merged migrations; add the next migration.
- Name database constraints explicitly.

## Quality gates

The established gate is conceptually:

```text
npm ci
npm run typecheck
npm test
npm run db:migrate
npm run test:integration
npm run build
git diff --check
docker compose config --quiet
```

Use the actual scripts present in `package.json` and CI. Do not invent a lint step if none exists; report its absence honestly.

Read-only audit commands may report known dependency findings. Do not apply a forced downgrade or unrelated semver-major change.

## PostgreSQL integration safety

The integration harness is deliberately destructive only inside randomized disposable child databases.

Preserve these rules:

- Explicit opt-in must be present.
- Base target must be numeric loopback `127.0.0.1`.
- Database name must match the conservative `_test` rule.
- No query, fragment, service, SSL, socket, host override, DNS, remote IP, or encoded ambiguity.
- Only reconstructed allowlisted connection properties reach `pg`.
- Verify the live base database before child creation.
- Create a cryptographically random child name.
- Run migrations/tests only in the child.
- Drop only the exact validated child.
- Always close pools and leave no child database.
- Never truncate or drop the base `cernix_test` database.

Run refusal tests without opt-in to prove pool construction is not reached.

## External-provider safety

- Constant trusted origins.
- No arbitrary URL acceptance in provider clients.
- Manual redirect handling where required.
- Server-only credentials.
- Bounded response streaming.
- Per-request and overall deadlines.
- Shared request budgets.
- Bounded concurrency.
- Safe retries only for classified transient conditions.
- No provider message/body/request ID/token in public data or logs.
- Offline fixtures in normal CI.
- Live smoke only with exact opt-in and pinned input.

## Lifecycle integrity

- Use one authoritative transition table.
- Same-state behavior may be idempotent.
- Terminal states never regress.
- Every transition that changes durable lifecycle is transactional with its corresponding durable effect/event.
- A route or worker must recheck lifecycle after acquiring the relevant database lock.
- UI navigation never substitutes for a backend transition.

## Job and worker integrity

- PostgreSQL owns job state.
- Claims use row locking and skip locked where appropriate.
- Leases use opaque tokens and database time.
- Every post-claim mutation is fenced by the current unexpired token.
- External work happens outside transactions.
- Execution is at least once; effects are idempotent.
- Retries are classified from stable codes, never arbitrary messages.
- Attempts and next availability are persisted.
- Stale workers cannot finalize.
- Worker import never starts a loop.
- Shutdown stops new claims and cleans timers/listeners/pools.

## Model/agent integrity

- Model output is untrusted external input.
- Validate with strict schemas.
- Bound prompt/context/output sizes.
- Persist model, prompt, schema, and policy versions.
- Give agents only admitted snapshot content.
- Require evidence citations.
- Agents never write lifecycle state directly.
- Planner does not judge.
- Investigator does not issue final verdict.
- Skeptic challenges; it does not rewrite evidence.
- Judge cannot cite evidence absent from durable evidence records.
- Report compiler cannot invent evidence.
- No arbitrary model tool/network access.

## Frontend rules

- Preserve Cobalt Terminal design.
- Backend becomes authoritative during cutover.
- Keep demo/sample data explicitly labelled and isolated.
- Never fall back to a sample report for an unknown real ID.
- Show honest loading, unavailable, conflict, failed, incomplete, and limitation states.
- Do not fabricate live progress percentages.
- Accessibility and keyboard navigation are required before final release.

## Error and logging rules

Public errors contain only fixed safe codes/messages and bounded safe issues.

Never expose or log:

- Tokens or authorization headers.
- Database URLs/passwords.
- Provider raw messages/bodies/request IDs.
- Repository file contents or secret matches.
- SQL or constraint details publicly.
- Stack traces/causes publicly.
- Lease tokens.
- Model raw chain-of-thought.

Operational logs may contain bounded IDs, safe status codes, attempt numbers, durations, and counts.

## Implementation report requirements

Every completed milestone report should include:

- Outcome.
- Branch, base, and complete commit hashes.
- Complete file list with purposes.
- Architecture and state-machine behavior.
- Security and concurrency guarantees.
- Migration/backfill/rollback behavior.
- Tests and exact counts.
- Every verification result.
- Dependency and audit delta.
- Diff statistics.
- Final clean Git status.
- Confirmation nothing was pushed unless authorized.
- Remaining limitations separated from unresolved defects.

## Review cycle

Use this cycle:

```text
implementation
→ detailed implementation report
→ deep read-only review
→ bounded remediation if required
→ final sign-off
→ push and PR
→ CI
→ merge
```

Do not skip review because tests pass. Do not continue stacking new milestones on an unmerged feature branch.


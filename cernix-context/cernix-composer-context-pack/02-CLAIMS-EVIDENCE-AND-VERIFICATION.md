# Cernix Claims, Evidence, and Verification Framework

## Authority rule

This document describes the conceptual verification model. The merged repository is authoritative for exact enum names, schemas, field limits, and lifecycle transitions. Composer must inspect those contracts and extend them rather than replacing them.

## Claim model

A claim is a bounded, falsifiable statement about the software project or repository.

A useful claim contains:

- A subject: the component, behavior, process, or property being discussed.
- A predicate: what is asserted about it.
- A scope: repository, package, route, environment, workflow, or critical path.
- Qualifiers: conditions, exceptions, versions, time boundaries, or deployment assumptions.
- Criticality: how materially the project depends on it.
- Origin: maintainer-supplied, submission-derived, documentation-derived, or system-suggested.

Bad claim:

```text
The code is secure.
```

Better claim:

```text
Every administrative API route in this repository enforces the shared authorization guard before performing a state-changing operation.
```

## Conceptual claim taxonomy

Use taxonomy as planning metadata, not as a substitute for reading the claim.

### Implementation/existence

Asserts that a component, route, control, workflow, or feature exists in the inspected code.

### Behavioral

Asserts that code behaves in a particular way under stated inputs or conditions.

### Security/control

Asserts authentication, authorization, validation, secret handling, isolation, least privilege, or another security property.

### Reliability/operational

Asserts retries, idempotency, failure recovery, observability, timeout, concurrency, or availability behavior.

### Testing/quality

Asserts test coverage, quality gates, type safety, linting, regression protection, or validation of critical behavior.

### Architecture/integration

Asserts boundaries, data flows, dependencies, protocols, component ownership, or the implementation of a documented design.

### Reproducibility/provenance

Asserts deterministic builds, pinned inputs, traceable artifacts, version identity, or source provenance.

### Dependency/supply chain

Asserts dependency constraints, lockfile behavior, vulnerability posture, package origin, or update policy.

### Documentation/governance

Asserts that documentation, contribution rules, release policy, ownership, or maintenance behavior matches repository evidence.

### Performance/scalability

Asserts latency, throughput, resource bounds, concurrency capacity, or complexity. Static evidence usually cannot fully verify runtime performance; such claims require strong limitations unless benchmark artifacts are present and trustworthy.

## Verification obligations

Before searching for evidence, Cernix decomposes a claim into obligations: the smaller conditions that must hold for the claim to be justified.

Example claim:

```text
Snapshot jobs recover safely after a worker crash.
```

Possible obligations:

1. A claimed job has a bounded lease.
2. Lease ownership is represented by an unguessable fencing token.
3. Another worker can reclaim an expired lease.
4. The stale worker cannot finalize after reclamation.
5. Attempt state is durable.
6. Snapshot effects are idempotent.
7. Lifecycle transitions cannot duplicate or regress.
8. Tests exercise crash/reclaim races against real PostgreSQL.

Obligations prevent a single attractive code snippet from being mistaken for complete proof.

## Evidence model

Evidence must be structured and source-bound.

Conceptually, an evidence item should include:

- Stable evidence ID.
- Investigation ID and claim ID.
- Evidence type.
- Repository snapshot ID and manifest hash.
- Exact commit SHA.
- File path.
- Line or symbol location where possible.
- Extracted observation or bounded excerpt.
- Hash/provenance information when relevant.
- Agent/source that collected it.
- Which obligation it supports or weakens.
- Strength/relevance assessment.
- Limitations.

Evidence types may include:

- Code implementation.
- Test implementation.
- Configuration.
- Migration/schema constraint.
- CI workflow.
- Documentation.
- Package/dependency metadata.
- Repository structure.
- Absence/gap evidence, carefully qualified.
- Cross-file consistency or contradiction.

## Evidence strength

Evidence is not equally probative.

Example hierarchy for a behavioral claim:

```text
documented assertion only
< implementation pattern
< implementation plus focused unit test
< implementation plus adversarial integration test
< reproducible runtime observation in an authorized sandbox
```

The hierarchy is contextual. A database constraint can be stronger evidence for a relational invariant than a unit test. A README statement is weak evidence for runtime behavior but useful evidence of project intent.

## Counterevidence

Counterevidence is evidence that weakens, contradicts, narrows, or exposes an exception to a claim.

Examples:

- One administrative route bypasses the shared guard.
- Tests mock the production component rather than exercising it.
- The documented retry limit differs from the persisted value.
- A migration constraint permits a state the application claims is impossible.
- The claimed feature exists only in sample/demo data.

Counterevidence must be preserved in the report even when the final judgment remains positive.

## Judgment vocabulary

The current UI and product direction center on three user-facing outcomes:

### Verified

The inspected evidence satisfies the material obligations within the declared scope, and no unresolved challenge materially defeats the claim.

### Partially verified

Some material obligations are supported, but evidence gaps, narrower actual scope, counterexamples, or non-repository dependencies prevent full verification.

### Unverified

The available evidence does not sufficiently support the claim. This does not automatically mean the claim is false; it means Cernix cannot justify it from the inspected evidence.

If merged code contains more precise internal statuses, preserve them and map them honestly to the user-facing vocabulary. Do not add “contradicted,” “false,” or “not applicable” casually without a reviewed contract decision.

## Confidence

Confidence is not a decorative probability and must not be invented from model sentiment.

Confidence should be derived from explicit factors such as:

- Obligation coverage.
- Evidence strength.
- Evidence independence.
- Source completeness.
- Counterevidence severity.
- Challenge resolution.
- Static-versus-runtime limitation.
- Snapshot coverage/exclusions.

Confidence must be explainable. A numeric value, if used, must be accompanied by its basis and limitations.

## Challenge framework

The skeptic does not merely ask for more evidence. It should attempt concrete defeat strategies:

- Find an unexamined call path.
- Find a bypass or exception.
- Check whether a test mocks the behavior it claims to prove.
- Compare application validation with database constraints.
- Look for lifecycle regression or race conditions.
- Test whether evidence comes from demo/sample code rather than production paths.
- Check documentation drift.
- Search for a narrower interpretation that the evidence actually supports.
- Identify external/runtime assumptions absent from the snapshot.
- Check whether absence claims are based on incomplete snapshot coverage.

The judge must respond to material challenges explicitly.

## Limitations framework

Limitations are first-class report content.

Common limitations:

- Static repository inspection cannot prove deployed runtime state.
- Excluded binaries, generated files, secrets, oversized files, lockfiles, or Git LFS objects were not inspected.
- Private services and infrastructure are outside the public snapshot.
- Tests may not represent production execution.
- Absence of evidence is not evidence of absence when coverage is incomplete.
- Model interpretation can be wrong and must remain traceable to source.
- The snapshot represents one exact commit, not future or historical versions.

## Determinism boundary

Deterministic components should include:

- Repository identity and commit resolution.
- Snapshot admission policy.
- Manifest construction.
- Source citations.
- Schema validation.
- Lifecycle rules.
- Job ownership/fencing.
- Evidence storage format.

Model-generated planning, interpretation, and challenge may vary. Cernix should constrain that variability through structured schemas, bounded prompts, explicit source context, versioned model configuration, and stored provenance.

## Report integrity

A report is valid only when:

- It belongs to the correct investigation.
- The investigation has reached a reportable terminal state.
- Every claim belongs to that investigation.
- Evidence references the correct immutable snapshot.
- Judgments refer only to selected claims.
- Material challenges and limitations are present.
- No sample fixture is silently substituted for unknown IDs.
- Replaying stored evidence/report data passes its authoritative validator.


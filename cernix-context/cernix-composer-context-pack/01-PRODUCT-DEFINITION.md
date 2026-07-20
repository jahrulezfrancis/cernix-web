# Cernix Product Definition

## Product thesis

Software repositories contain code, tests, configuration, documentation, automation, and history—but stakeholders often make claims that go beyond what those artifacts actually prove.

Examples:

- “Authentication is enforced on every administrative endpoint.”
- “The build is reproducible.”
- “Secrets are never logged.”
- “This service retries transient failures safely.”
- “The repository has complete test coverage for its critical path.”
- “The architecture described in the documentation is implemented.”

Ordinary code-review tools identify issues. Repository chat tools answer questions. Static analyzers detect known patterns. Cernix instead asks:

```text
What exactly is being claimed?
What evidence would be required to support it?
What evidence exists in this exact repository snapshot?
What plausible counterexamples or gaps remain?
What judgment is justified—and no stronger?
```

## Primary users

### Maintainers

Maintainers use Cernix to verify release claims, check whether implementation matches documentation, prepare evidence for grants or audits, identify unsupported project assertions, and communicate limitations honestly.

### Technical reviewers and due-diligence teams

Reviewers use Cernix to examine a project without relying solely on demos, README claims, contributor activity, or maintainer assurances.

### Open-source funding and grant programs

Programs can use Cernix to distinguish visible repository activity from implemented, maintained, and evidenced capability.

### Engineering teams and security reviewers

Teams can investigate focused claims about architecture, testing, security controls, reliability, and operational behavior.

### Contributors

Contributors can see which claims lack evidence, where verification gaps exist, and which improvements would materially strengthen the project.

## MVP investigation flow

```text
New Investigation
→ Claim Review
→ Repository Snapshot
→ Planning
→ Investigation
→ Challenge
→ Judgment
→ Evidence Report
```

### 1. New Investigation

The user supplies:

- Project context.
- Public GitHub repository URL.
- Branch, tag, or commit reference.
- Submission context where relevant.
- A focus question and/or manual claims.

The system creates an authoritative investigation record and preserves the requested repository identity and ref.

### 2. Claim Review

Cernix presents candidate claims and their interpretations. The user can select, exclude, edit, and mark critical claims. The MVP permits no more than five selected claims per investigation.

Claim review is not cosmetic. The selected claims become the exact scope for planning, evidence collection, challenge, and judgment.

### 3. Repository Snapshot

Cernix resolves the public repository and requested ref to one exact commit, inventories the tree, applies a deterministic admission policy, verifies Git blob identity, excludes secrets and unsafe content, and persists an immutable application-level snapshot with a reproducible manifest hash.

### 4. Planning

Each selected claim is decomposed into verification obligations. A planner identifies what evidence would support or weaken the claim and assigns bounded tasks to specialist agents.

### 5. Investigation

Specialist agents examine the admitted snapshot. They return structured evidence citations, observations, counterevidence, missing evidence, and limitations—not free-form conclusions detached from source locations.

### 6. Challenge

The skeptic agent attempts to defeat the provisional conclusion. It searches for alternative explanations, unexamined paths, misleading tests, documentation drift, and evidence that does not actually prove the claim.

### 7. Judgment

The judge evaluates claim meaning, obligations, evidence, challenges, gaps, and limitations. It produces a bounded verdict and confidence rationale.

### 8. Evidence Report

The report shows:

- Repository and exact commit.
- Snapshot/manifest identity.
- Claim and interpretation.
- Verification obligations.
- Evidence and source citations.
- Counterevidence and skeptic challenges.
- Judgment and confidence.
- Limitations and unresolved gaps.
- Maintainer actions that could improve verification.

## Success criteria

For the MVP, Cernix succeeds when a user can submit a public repository, choose up to five claims, allow a durable investigation to run, and receive a report where every judgment is traceable to a fixed repository snapshot and explicit evidence.

## Product non-goals for the current build

- General autonomous coding.
- Automatic pull-request creation.
- Running untrusted repository code.
- Full security certification.
- Legal or compliance certification.
- Proof that runtime production behavior matches repository code.
- Private repository access.
- Organization-wide governance workflows.
- An unrestricted repository chatbot.
- Replacing human maintainers or professional auditors.

## Honest product language

Use:

- “Evidence supports this claim.”
- “Partially verified within the inspected snapshot.”
- “No sufficient repository evidence was found.”
- “The result is limited by static repository evidence.”
- “The repository snapshot was resolved to commit …”

Avoid:

- “Cernix guarantees this software is secure.”
- “The AI proved the system works in production.”
- “No vulnerability exists.”
- “Complete verification” when execution, external infrastructure, or runtime state was not inspected.
- “Live” for deterministic mock data.

## Design character

Cernix should feel like an investigation instrument, not a chatbot. Interfaces should privilege evidence density, provenance, status clarity, and navigable reasoning. The user should always be able to answer:

```text
What is being checked?
What is happening now?
What evidence was found?
Who/what produced this conclusion?
What remains uncertain?
```


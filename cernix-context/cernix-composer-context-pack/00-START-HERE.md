# Cernix Composer Context Pack

This pack gives an implementation agent enough product, domain, architecture, and engineering context to continue Cernix without flattening it into a generic AI code-review tool.

## How to use this pack

Give Composer the entire folder and instruct it to read the documents in this order:

1. `00-START-HERE.md`
2. `01-PRODUCT-DEFINITION.md`
3. `02-CLAIMS-EVIDENCE-AND-VERIFICATION.md`
4. `03-SYSTEM-ARCHITECTURE.md`
5. `04-CURRENT-IMPLEMENTATION-AND-ROADMAP.md`
6. `05-ENGINEERING-OPERATING-RULES.md`
7. `06-CURRENT-TASK-MILESTONE-6.md`

The repository remains authoritative for exact schemas, enums, migrations, routes, types, and behavior. These documents explain the intent and boundaries around that code. When a document and merged production code differ, Composer must:

1. Stop and identify the difference.
2. Determine whether the code reflects a later reviewed decision.
3. Preserve the hardened merged behavior unless explicitly authorized to change it.
4. Never silently rewrite a contract to match prose.

## One-sentence definition

Cernix is an evidence-driven technical due-diligence system that turns claims about a software repository into reproducible investigations, challenges the evidence, and produces an auditable report showing what is verified, partially verified, unverified, or limited by the available evidence.

## What makes Cernix distinct

Cernix does not merely summarize a repository or generate a conventional code review. Its core object is a claim, and its product promise is:

```text
claim
→ explicit verification obligations
→ immutable repository snapshot
→ evidence gathered by specialized investigators
→ adversarial challenge
→ bounded judgment
→ traceable report with limitations
```

Every important conclusion must be connected to evidence, provenance, a verification method, and a known limitation. Confidence must never be presented as certainty when the evidence cannot support certainty.

## Current product position

Cernix currently has:

- A designed Cobalt Terminal frontend.
- A persistent frontend investigation prototype using localStorage and deterministic mock data.
- Hardened backend contracts and GitHub repository-reference parsing.
- PostgreSQL investigation, claim, lifecycle-event, idempotency, and snapshot-job persistence.
- Immutable, deterministic, bounded public-GitHub repository snapshots at exact commits.
- Cryptographic replay verification tying stored file bytes back to Git blob object identities.
- Extensive offline unit tests and guarded PostgreSQL 17 integration tests.

Cernix does not yet have:

- A running durable job worker.
- Real planning or multi-agent investigation.
- Qwen integration.
- Backend API/frontend cutover for the complete investigation flow.
- Authentication or multi-user project ownership.
- Streaming progress.
- Production deployment and worker supervision.

## Immediate task

The next implementation task is Milestone 6: durable snapshot-job orchestration. Composer should use `06-CURRENT-TASK-MILESTONE-6.md` only after reading the rest of the pack and inspecting the actual repository.

## Non-negotiable product principles

- Evidence before assertion.
- Exact source and commit provenance.
- Reproducibility over convenience.
- Honest uncertainty and limitations.
- Adversarial challenge before judgment.
- Deterministic behavior where the same inputs should produce the same artifact.
- No repository code execution during evidence collection unless a later sandboxed-execution milestone explicitly authorizes it.
- No secret persistence.
- No claim of “live” behavior when data is mocked or static.
- No silent lifecycle regression.
- No bypass around authoritative backend state once the frontend is cut over.

## Visual direction

The chosen visual system is Cobalt Terminal: a serious, technical, high-density interface with cobalt accents, dark terminal-like surfaces, sharp information hierarchy, evidence panels, restrained status colors, and minimal decorative UI.

Preserve the palette and visual language unless explicitly asked to redesign it. Do not replace it with a generic purple AI gradient, glassmorphism template, oversized marketing cards, or playful chatbot styling.


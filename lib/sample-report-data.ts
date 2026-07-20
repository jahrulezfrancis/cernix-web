import type {
  Report,
  Claim,
  Evidence,
  ProofObligation,
  Challenge,
  EvidenceGap,
  Judgment,
} from "./types";

// ─── Sample Report: acme/stellar-service ─────────────────────────────────────

export const SAMPLE_REPO_SNAPSHOT = {
  owner: "acme",
  repo: "stellar-service",
  branch: "main",
  commitSha: "a84c9f1e3b2d5f8a0c1e4b7d9f2a3c6e8b1d4f7a",
  primaryLanguage: "TypeScript",
  languages: ["TypeScript", "Rust"],
  sizeKb: 4820,
  fileCount: 312,
  hasTests: true,
  hasWorkflows: true,
  snapshotAt: "2025-06-14T09:22:00Z",
};

export const SAMPLE_CLAIMS: Claim[] = [
  {
    id: "clm-001",
    investigationId: "inv-sample",
    originalStatement:
      '"The service validates payment signatures using Ed25519."',
    normalizedInterpretation:
      "All payment requests are cryptographically verified using Ed25519 signatures before processing proceeds.",
    category: "security_privacy",
    criticality: "critical",
    verifiability: "verifiable",
    preservedQualifiers: ["validates", "every payment", "before processing"],
    selected: true,
    status: "completed",
    verdict: "verified",
    confidence: "high",
    evidenceCount: 4,
    openLimitations: 0,
    requiresHumanReview: false,
  },
  {
    id: "clm-002",
    investigationId: "inv-sample",
    originalStatement:
      '"Refund operations are idempotent per transaction and user."',
    normalizedInterpretation:
      "Refund operations may be safely retried and produce the same result; duplicate requests are detected and deduplicated per (transaction_id, user_id) pair.",
    category: "implementation",
    criticality: "critical",
    verifiability: "verifiable",
    preservedQualifiers: ["per transaction and user", "idempotent"],
    selected: true,
    status: "completed",
    verdict: "partially_verified",
    confidence: "moderate",
    evidenceCount: 3,
    openLimitations: 1,
    requiresHumanReview: true,
  },
  {
    id: "clm-003",
    investigationId: "inv-sample",
    originalStatement: '"No card numbers are logged or persisted."',
    normalizedInterpretation:
      "Primary Account Numbers (PANs) and full card numbers do not appear in application logs, database records, or any persisted storage.",
    category: "security_privacy",
    criticality: "critical",
    verifiability: "partially_verifiable",
    preservedQualifiers: ["no card numbers", "logged", "persisted"],
    selected: true,
    status: "completed",
    verdict: "unverified",
    confidence: "low",
    evidenceCount: 2,
    openLimitations: 2,
    requiresHumanReview: true,
  },
  {
    id: "clm-004",
    investigationId: "inv-sample",
    originalStatement: '"Webhook events are delivered at least once."',
    normalizedInterpretation:
      "The webhook delivery system guarantees at-least-once delivery semantics, with retry logic that ensures no event is permanently dropped.",
    category: "implementation",
    criticality: "high",
    verifiability: "verifiable",
    preservedQualifiers: ["at least once", "delivered"],
    selected: true,
    status: "completed",
    verdict: "verified",
    confidence: "high",
    evidenceCount: 5,
    openLimitations: 0,
    requiresHumanReview: false,
  },
  {
    id: "clm-005",
    investigationId: "inv-sample",
    originalStatement:
      '"Every pull request must pass CI before merge."',
    normalizedInterpretation:
      "Branch protection rules require all CI checks to pass and no review approvals to be bypassed before a pull request may be merged into the main branch.",
    category: "testing_delivery",
    criticality: "high",
    verifiability: "partially_verifiable",
    preservedQualifiers: ["every", "must pass", "before merge"],
    selected: true,
    status: "completed",
    verdict: "partially_verified",
    confidence: "moderate",
    evidenceCount: 3,
    openLimitations: 1,
    requiresHumanReview: false,
  },
];

export const SAMPLE_EVIDENCE: Record<string, Evidence[]> = {
  "clm-001": [
    {
      id: "ev-001-1",
      claimId: "clm-001",
      investigationId: "inv-sample",
      type: "source_code",
      strength: "strong",
      observation:
        "Ed25519 signature verification implemented in PaymentValidator.verify() using the `ed25519-dalek` Rust crate via FFI bridge.",
      repositoryPath: "src/payments/validator.ts",
      commitSha: "a84c9f1",
      lineStart: 42,
      lineEnd: 67,
      codeExcerpt: `import { verify } from '../ffi/ed25519_bridge';

export class PaymentValidator {
  async verify(payload: PaymentPayload, signature: string): Promise<boolean> {
    const publicKey = await this.keyStore.getPublicKey(payload.merchantId);
    if (!publicKey) throw new ValidationError('Unknown merchant');
    
    const message = this.canonicalize(payload);
    const valid = verify(
      Buffer.from(message, 'utf8'),
      Buffer.from(signature, 'hex'),
      publicKey
    );
    
    if (!valid) {
      this.audit.log('signature_failure', { merchantId: payload.merchantId });
      throw new SignatureError('Invalid Ed25519 signature');
    }
    return true;
  }
}`,
      relevance:
        "Directly implements the claimed Ed25519 validation. The verification is called before any payment processing logic.",
      validation: "accepted",
      discoveredBy: "repository_investigator",
    },
    {
      id: "ev-001-2",
      claimId: "clm-001",
      investigationId: "inv-sample",
      type: "source_code",
      strength: "strong",
      observation:
        "Middleware pipeline enforces PaymentValidator.verify() on every POST /payments route before the handler executes.",
      repositoryPath: "src/middleware/auth.ts",
      commitSha: "a84c9f1",
      lineStart: 88,
      lineEnd: 102,
      codeExcerpt: `export const paymentAuthMiddleware = compose([
  rateLimiter({ windowMs: 60_000, max: 100 }),
  validator.verifyPaymentSignature,   // Ed25519 gate
  idempotencyCheck,
  handler,
]);`,
      relevance:
        "Confirms the validator is enforced at the middleware layer, not optionally called by individual handlers.",
      validation: "accepted",
      discoveredBy: "repository_investigator",
    },
    {
      id: "ev-001-3",
      claimId: "clm-001",
      investigationId: "inv-sample",
      type: "test",
      strength: "strong",
      observation:
        "18 unit tests cover valid signatures, tampered payloads, expired keys, and unknown merchants. All pass in CI.",
      repositoryPath: "tests/payments/validator.test.ts",
      commitSha: "a84c9f1",
      lineStart: 1,
      lineEnd: 145,
      codeExcerpt: `describe('PaymentValidator', () => {
  it('accepts a valid Ed25519 signature', async () => { ... });
  it('rejects a tampered payload', async () => { ... });
  it('rejects an expired key', async () => { ... });
  // 15 more cases
});`,
      relevance:
        "Test coverage confirms the implementation handles adversarial inputs, not just the happy path.",
      validation: "accepted",
      discoveredBy: "delivery_investigator",
    },
    {
      id: "ev-001-4",
      claimId: "clm-001",
      investigationId: "inv-sample",
      type: "dependency",
      strength: "moderate",
      observation:
        "Cargo.toml pins `ed25519-dalek = \"2.1.0\"` and `sha2 = \"0.10.8\"`, confirming the cryptographic dependency is a production dependency, not dev-only.",
      repositoryPath: "Cargo.toml",
      commitSha: "a84c9f1",
      lineStart: 18,
      lineEnd: 22,
      codeExcerpt: `[dependencies]
ed25519-dalek = "2.1.0"
sha2 = "0.10.8"
rand = { version = "0.8", optional = true }`,
      relevance: "Confirms the algorithm is implemented, not mocked.",
      validation: "accepted",
      discoveredBy: "repository_investigator",
    },
  ],
  "clm-002": [
    {
      id: "ev-002-1",
      claimId: "clm-002",
      investigationId: "inv-sample",
      type: "source_code",
      strength: "strong",
      observation:
        "RefundService.process() checks an idempotency key composed of (transactionId, userId) against a Redis store before executing.",
      repositoryPath: "src/refunds/service.ts",
      commitSha: "a84c9f1",
      lineStart: 31,
      lineEnd: 58,
      codeExcerpt: `async process(request: RefundRequest): Promise<RefundResult> {
  const key = \`refund:\${request.transactionId}:\${request.userId}\`;
  const existing = await this.redis.get(key);
  
  if (existing) {
    return JSON.parse(existing) as RefundResult;  // return cached result
  }
  
  const result = await this.executeRefund(request);
  await this.redis.setex(key, 86_400, JSON.stringify(result));
  return result;
}`,
      relevance:
        "Implements idempotency via a composite key that matches the claimed (transaction, user) scope.",
      validation: "accepted",
      discoveredBy: "repository_investigator",
    },
    {
      id: "ev-002-2",
      claimId: "clm-002",
      investigationId: "inv-sample",
      type: "test",
      strength: "moderate",
      observation:
        "5 integration tests cover duplicate refund requests within the 24-hour window. Concurrent duplicate requests are not tested.",
      repositoryPath: "tests/refunds/idempotency.test.ts",
      commitSha: "a84c9f1",
      lineStart: 1,
      lineEnd: 87,
      codeExcerpt: `it('returns same result for duplicate refund within 24h', async () => {
  const r1 = await service.process(req);
  const r2 = await service.process(req);
  expect(r2).toEqual(r1);
});`,
      relevance:
        "Tests sequential duplicates but does not cover the race condition under concurrent requests.",
      validation: "accepted",
      discoveredBy: "delivery_investigator",
    },
    {
      id: "ev-002-3",
      claimId: "clm-002",
      investigationId: "inv-sample",
      type: "configuration",
      strength: "weak",
      observation:
        "Redis connection configured without a distributed lock (SETNX/Lua script), creating a potential window for concurrent duplicate execution.",
      repositoryPath: "src/config/redis.ts",
      commitSha: "a84c9f1",
      lineStart: 1,
      lineEnd: 24,
      codeExcerpt: `export const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
  // No distributed lock configuration
});`,
      relevance:
        "Without a distributed lock, two simultaneous refund requests with the same key could both pass the existence check before either writes.",
      validation: "accepted",
      discoveredBy: "skeptic_agent",
    },
  ],
  "clm-003": [
    {
      id: "ev-003-1",
      claimId: "clm-003",
      investigationId: "inv-sample",
      type: "source_code",
      strength: "moderate",
      observation:
        "Logger utility strips known sensitive field names (password, token, secret) from log objects, but 'card', 'pan', and 'cardNumber' are not in the redaction list.",
      repositoryPath: "src/utils/logger.ts",
      commitSha: "a84c9f1",
      lineStart: 8,
      lineEnd: 22,
      codeExcerpt: `const REDACTED_FIELDS = ['password', 'token', 'secret', 'apiKey'];

export function sanitize(obj: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
      REDACTED_FIELDS.includes(k) ? [k, '[REDACTED]'] : [k, v]
    )
  );
}`,
      relevance:
        "The redaction list does not include card-related field names, leaving a gap in PAN protection.",
      validation: "accepted",
      discoveredBy: "skeptic_agent",
    },
    {
      id: "ev-003-2",
      claimId: "clm-003",
      investigationId: "inv-sample",
      type: "documentation",
      strength: "weak",
      observation:
        "README states 'card data is never stored', but no audit log search or database schema inspection was available to confirm this at the storage layer.",
      repositoryPath: "README.md",
      commitSha: "a84c9f1",
      lineStart: 44,
      lineEnd: 47,
      codeExcerpt: `## Security\nCard data is never stored in our database. We rely entirely on\nour payment processor tokenization.`,
      relevance:
        "Documentation asserts the claim but cannot be treated as evidence; inspection of the database schema is required.",
      validation: "accepted",
      discoveredBy: "repository_investigator",
    },
  ],
  "clm-004": [
    {
      id: "ev-004-1",
      claimId: "clm-004",
      investigationId: "inv-sample",
      type: "source_code",
      strength: "strong",
      observation:
        "WebhookDispatcher implements exponential backoff retry with up to 8 attempts over 24 hours before marking delivery as permanently failed.",
      repositoryPath: "src/webhooks/dispatcher.ts",
      commitSha: "a84c9f1",
      lineStart: 55,
      lineEnd: 88,
      codeExcerpt: `const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 1_000;

async dispatch(event: WebhookEvent): Promise<DispatchResult> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await this.send(event);
      return { status: 'delivered', attempt };
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        await this.deadLetterQueue.enqueue(event);
        return { status: 'failed', attempt };
      }
      await sleep(BASE_DELAY_MS * 2 ** attempt + jitter());
    }
  }
}`,
      relevance:
        "Implements at-least-once semantics with dead-letter queue for permanent failures.",
      validation: "accepted",
      discoveredBy: "repository_investigator",
    },
    {
      id: "ev-004-2",
      claimId: "clm-004",
      investigationId: "inv-sample",
      type: "test",
      strength: "strong",
      observation:
        "Integration tests simulate transient failures and verify that delivery is retried and eventually succeeds.",
      repositoryPath: "tests/webhooks/dispatcher.test.ts",
      commitSha: "a84c9f1",
      lineStart: 1,
      lineEnd: 60,
      codeExcerpt: `it('retries on transient 503 and delivers on attempt 3', async () => {
  mockServer.failFor(2).then.succeed();
  const result = await dispatcher.dispatch(event);
  expect(result.status).toBe('delivered');
  expect(result.attempt).toBe(3);
});`,
      relevance:
        "Directly validates the retry behavior described in the claim.",
      validation: "accepted",
      discoveredBy: "delivery_investigator",
    },
  ],
  "clm-005": [
    {
      id: "ev-005-1",
      claimId: "clm-005",
      investigationId: "inv-sample",
      type: "ci_workflow",
      strength: "strong",
      observation:
        "GitHub Actions workflow `ci.yml` runs on `pull_request` events and executes lint, type-check, unit tests, and integration tests.",
      repositoryPath: ".github/workflows/ci.yml",
      commitSha: "a84c9f1",
      lineStart: 1,
      lineEnd: 45,
      codeExcerpt: `on:
  pull_request:
    branches: [main, develop]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm type-check
      - run: pnpm test:unit
      - run: pnpm test:integration`,
      relevance:
        "CI workflow is correctly configured to run on pull request events.",
      validation: "accepted",
      discoveredBy: "delivery_investigator",
    },
    {
      id: "ev-005-2",
      claimId: "clm-005",
      investigationId: "inv-sample",
      type: "branch_protection",
      strength: "inconclusive",
      observation:
        "Branch protection settings for `main` were not accessible via the available repository snapshot. GitHub branch protection rules cannot be inspected without authenticated API access.",
      repositoryPath: "N/A — requires GitHub API",
      commitSha: "a84c9f1",
      relevance:
        "Without branch protection confirmation, CI checks could theoretically be bypassed by direct push access.",
      validation: "accepted",
      discoveredBy: "delivery_investigator",
    },
  ],
};

export const SAMPLE_PROOF_OBLIGATIONS: Record<string, ProofObligation[]> = {
  "clm-001": [
    {
      id: "po-001-1",
      claimId: "clm-001",
      description:
        "Ed25519 algorithm is used (not a weaker signature scheme)",
      status: "satisfied",
      decisiveEvidenceId: "ev-001-1",
    },
    {
      id: "po-001-2",
      claimId: "clm-001",
      description: "Validation occurs on every payment request",
      status: "satisfied",
      decisiveEvidenceId: "ev-001-2",
    },
    {
      id: "po-001-3",
      claimId: "clm-001",
      description: "Validation failure prevents payment processing",
      status: "satisfied",
      decisiveEvidenceId: "ev-001-1",
    },
  ],
  "clm-002": [
    {
      id: "po-002-1",
      claimId: "clm-002",
      description: "Duplicate requests return the same result",
      status: "satisfied",
      decisiveEvidenceId: "ev-002-1",
    },
    {
      id: "po-002-2",
      claimId: "clm-002",
      description: "Idempotency key scoped to (transaction_id, user_id)",
      status: "satisfied",
      decisiveEvidenceId: "ev-002-1",
    },
    {
      id: "po-002-3",
      claimId: "clm-002",
      description: "Concurrent duplicate requests handled safely",
      status: "partially_satisfied",
      decisiveEvidenceId: "ev-002-3",
    },
  ],
  "clm-003": [
    {
      id: "po-003-1",
      claimId: "clm-003",
      description: "Card numbers absent from application log output",
      status: "unsatisfied",
      decisiveEvidenceId: "ev-003-1",
    },
    {
      id: "po-003-2",
      claimId: "clm-003",
      description: "Card numbers absent from database schema",
      status: "unknown",
    },
  ],
  "clm-004": [
    {
      id: "po-004-1",
      claimId: "clm-004",
      description: "Retry logic present and bounded",
      status: "satisfied",
      decisiveEvidenceId: "ev-004-1",
    },
    {
      id: "po-004-2",
      claimId: "clm-004",
      description: "Failed deliveries are not permanently dropped",
      status: "satisfied",
      decisiveEvidenceId: "ev-004-1",
    },
  ],
  "clm-005": [
    {
      id: "po-005-1",
      claimId: "clm-005",
      description: "CI workflow triggers on pull_request events",
      status: "satisfied",
      decisiveEvidenceId: "ev-005-1",
    },
    {
      id: "po-005-2",
      claimId: "clm-005",
      description:
        "Branch protection enforces required status checks before merge",
      status: "unknown",
      decisiveEvidenceId: "ev-005-2",
    },
  ],
};

export const SAMPLE_CHALLENGES: Record<string, Challenge[]> = {
  "clm-002": [
    {
      id: "ch-002-1",
      claimId: "clm-002",
      challengedEvidenceId: "ev-002-1",
      challengingAgent: "skeptic_agent",
      challengeText:
        "The idempotency implementation uses Redis GET/SET without a distributed lock. Two concurrent requests with the same key could both find no existing record and both proceed to execute the refund before either writes its result.",
      severity: "major",
      resolution:
        "Accepted. The sequential idempotency is implemented correctly, but the concurrent case is unaddressed. Verdict reduced from Verified to Partially Verified.",
      verdictChanged: true,
      verdictBefore: "verified",
      verdictAfter: "partially_verified",
    },
  ],
  "clm-005": [
    {
      id: "ch-005-1",
      claimId: "clm-005",
      challengedEvidenceId: "ev-005-1",
      challengingAgent: "skeptic_agent",
      challengeText:
        "The CI workflow configuration is present and correctly structured, but branch protection settings are inaccessible from the repository snapshot. Without confirmed required status checks, a maintainer with push access could bypass CI.",
      severity: "major",
      resolution:
        "Accepted. CI configuration is verified. Branch-protection enforcement remains unconfirmed. Verdict maintained as Partially Verified.",
      verdictChanged: false,
    },
  ],
};

export const SAMPLE_EVIDENCE_GAPS: Record<string, EvidenceGap[]> = {
  "clm-003": [
    {
      id: "eg-003-1",
      claimId: "clm-003",
      description: "Database schema not accessible for PAN field inspection",
      source: "Production database",
      unavailableReason:
        "Database connection string and schema migrations were not available in the repository snapshot.",
      impactOnVerdict:
        "Cannot confirm whether any table columns store card data. Verdict cannot exceed Unverified.",
    },
  ],
  "clm-005": [
    {
      id: "eg-005-1",
      claimId: "clm-005",
      description: "Branch protection rules not accessible",
      source: "GitHub repository settings",
      unavailableReason:
        "Branch protection configuration requires authenticated GitHub API access with admin scope.",
      impactOnVerdict:
        "CI workflow existence is confirmed. Enforcement of CI as a merge requirement cannot be verified.",
    },
  ],
};

export const SAMPLE_JUDGMENTS: Record<string, Judgment> = {
  "clm-001": {
    id: "jg-001",
    claimId: "clm-001",
    verdict: "verified",
    confidence: "high",
    summary:
      "Ed25519 signature validation is correctly implemented and enforced on all payment routes.",
    reasoning:
      "The repository contains a complete Ed25519 verification implementation using the ed25519-dalek Rust crate via FFI. The validator is applied as middleware on every payment endpoint, not left to individual handlers. Unit tests cover adversarial inputs. The production dependency confirms this is not a dev-only implementation.",
    unprovenAspects: [],
    whatCouldChangeVerdict: [
      "Evidence that the middleware is bypassed for certain merchant types or payment methods.",
    ],
    issuedAt: "2025-06-14T09:44:00Z",
  },
  "clm-002": {
    id: "jg-002",
    claimId: "clm-002",
    verdict: "partially_verified",
    confidence: "moderate",
    summary:
      "Sequential idempotency is implemented correctly. Concurrent duplicate requests represent an unresolved limitation.",
    reasoning:
      "The composite key (transactionId, userId) correctly scopes idempotency to the claimed pair. The Redis GET/SET pattern returns cached results for duplicate sequential requests. The Skeptic Agent identified a gap: without a distributed lock or SETNX pattern, concurrent duplicate requests could both pass the existence check before either result is written.",
    unprovenAspects: [
      "Concurrent duplicate requests handled safely under load.",
    ],
    whatCouldChangeVerdict: [
      "Addition of a distributed lock (e.g., Redlock) around the idempotency check.",
      "Evidence that the application deployment topology makes concurrent duplicates impossible in practice.",
    ],
    issuedAt: "2025-06-14T09:48:00Z",
  },
  "clm-003": {
    id: "jg-003",
    claimId: "clm-003",
    verdict: "unverified",
    confidence: "low",
    summary:
      "The claim cannot be verified from the available evidence. The logger redaction list omits card-related field names, and the database schema was inaccessible.",
    reasoning:
      "The logger sanitization utility does not include 'card', 'pan', or 'cardNumber' in its redaction list, creating a concrete path by which card data could appear in logs. The README asserts the claim but this cannot be treated as evidence. The database schema was unavailable for inspection.",
    unprovenAspects: [
      "Card field names absent from application log output.",
      "No card-related columns in any database table.",
    ],
    whatCouldChangeVerdict: [
      "Adding card-related field names to the logger redaction list.",
      "Providing database migration files for schema inspection.",
      "A log audit confirming no PAN-pattern strings appear in production logs.",
    ],
    issuedAt: "2025-06-14T09:52:00Z",
  },
  "clm-004": {
    id: "jg-004",
    claimId: "clm-004",
    verdict: "verified",
    confidence: "high",
    summary:
      "Webhook at-least-once delivery is correctly implemented with bounded retry and dead-letter handling.",
    reasoning:
      "The dispatcher implements exponential backoff across 8 attempts with jitter. After exhausting retries, events are moved to a dead-letter queue rather than discarded. Integration tests validate retry behavior under transient failures. No challenges were raised.",
    unprovenAspects: [],
    whatCouldChangeVerdict: [
      "Evidence that the dead-letter queue is not monitored or processed.",
    ],
    issuedAt: "2025-06-14T09:56:00Z",
  },
  "clm-005": {
    id: "jg-005",
    claimId: "clm-005",
    verdict: "partially_verified",
    confidence: "moderate",
    summary:
      "CI workflow configuration is present and correctly targets pull requests. Branch-protection enforcement could not be confirmed.",
    reasoning:
      "The GitHub Actions workflow triggers on pull_request events and runs a comprehensive check suite. Branch protection configuration is not accessible from the repository snapshot. Without confirmed required status checks, the claim that CI must pass before merge cannot be fully established.",
    unprovenAspects: ["Branch protection enforces required CI status checks."],
    whatCouldChangeVerdict: [
      "Providing evidence of branch protection configuration (e.g., a screenshot or exported settings).",
      "Making the repository public with admin API access.",
    ],
    issuedAt: "2025-06-14T10:00:00Z",
  },
};

export const SAMPLE_MAINTAINER_ACTIONS: Record<string, string[]> = {
  "clm-002": [
    "Replace the Redis GET/SET idempotency pattern with a Redlock-based distributed lock to handle concurrent requests safely.",
    "Add load tests that simulate concurrent duplicate refund requests and assert exactly one execution.",
  ],
  "clm-003": [
    "Add 'card', 'pan', 'cardNumber', 'cvv', and 'expiry' to the logger redaction list in src/utils/logger.ts.",
    "Add database migration files to the repository so schema inspection is possible during review.",
    "Document the tokenization flow and confirm that raw PANs never enter application memory after the payment processor handoff.",
  ],
  "clm-005": [
    "Document branch protection configuration in the repository (e.g., export settings or include a screenshot in CONTRIBUTING.md).",
    "Consider adding a workflow that validates branch protection is active using the GitHub CLI.",
  ],
};

export const SAMPLE_REPORT: Report = {
  id: "rpt-sample-001",
  investigationId: "inv-sample",
  projectName: "stellar-service",
  repositorySnapshot: SAMPLE_REPO_SNAPSHOT,
  submissionType: "hackathon_submission",
  investigationDate: "2025-06-14T09:20:00Z",
  durationSeconds: 2640,
  claimsInvestigated: 5,
  verified: 2,
  partiallyVerified: 2,
  unverified: 1,
  contradicted: 0,
  inconclusive: 0,
  overallCoverage: 74,
  summarySentence:
    "Core cryptographic and delivery claims are substantially supported. PAN protection and branch-enforcement claims require additional evidence before they can be confirmed.",
  criticalFindings: [
    "The logger redaction list does not include card-related field names, creating a path for PAN leakage into application logs.",
    "Refund idempotency is unprotected against concurrent duplicate requests; a distributed lock is absent.",
    "Branch protection settings were inaccessible; CI merge enforcement could not be confirmed.",
  ],
  coverage: {
    sourceCode: "complete",
    documentation: "complete",
    tests: "complete",
    ciWorkflows: "complete",
    pullRequests: "partial",
    branchProtection: "unavailable",
    runtimeDeployment: "unavailable",
    cloudRecords: "unavailable",
  },
  claims: SAMPLE_CLAIMS,
  judgments: SAMPLE_JUDGMENTS,
  evidence: SAMPLE_EVIDENCE,
  proofObligations: SAMPLE_PROOF_OBLIGATIONS,
  challenges: SAMPLE_CHALLENGES,
  evidenceGaps: SAMPLE_EVIDENCE_GAPS,
  maintainerActions: SAMPLE_MAINTAINER_ACTIONS,
};

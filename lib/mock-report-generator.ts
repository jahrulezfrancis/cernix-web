import type {
  Challenge,
  Claim,
  Confidence,
  Evidence,
  EvidenceGap,
  Investigation,
  Judgment,
  ProofObligation,
  Report,
  Verdict,
} from "./types";

const VERDICT_SEQUENCE: Array<{ verdict: Verdict; confidence: Confidence }> = [
  { verdict: "verified", confidence: "high" },
  { verdict: "partially_verified", confidence: "moderate" },
  { verdict: "unverified", confidence: "low" },
  { verdict: "verified", confidence: "high" },
  { verdict: "partially_verified", confidence: "moderate" },
];

function count(claims: Claim[], verdict: Verdict) {
  return claims.filter((claim) => claim.verdict === verdict).length;
}

function sourcePathFor(claim: Claim, index: number) {
  if (claim.category === "testing_delivery") return ".github/workflows/ci.yml";
  if (claim.category === "security_privacy") return "src/security/policy.ts";
  if (claim.category === "architecture") return "infra/main.tf";
  if (claim.category === "performance_outcome") return "tests/performance/p99.test.ts";
  return `src/claims/claim-${index + 1}.ts`;
}

export function buildMockReport(
  investigation: Investigation,
  elapsedSeconds: number
): Report {
  const selectedClaims = investigation.claims.filter((claim) => claim.selected);
  const completedClaims = selectedClaims.map((claim, index) => {
    const result = VERDICT_SEQUENCE[index % VERDICT_SEQUENCE.length];
    return {
      ...claim,
      status: "completed" as const,
      verdict: result.verdict,
      confidence: result.confidence,
      evidenceCount: result.verdict === "verified" ? 3 : 2,
      openLimitations: result.verdict === "verified" ? 0 : 1,
      requiresHumanReview:
        result.verdict === "unverified" || result.verdict === "partially_verified",
    };
  });

  const evidence: Record<string, Evidence[]> = {};
  const proofObligations: Record<string, ProofObligation[]> = {};
  const challenges: Record<string, Challenge[]> = {};
  const evidenceGaps: Record<string, EvidenceGap[]> = {};
  const judgments: Record<string, Judgment> = {};
  const maintainerActions: Record<string, string[]> = {};

  completedClaims.forEach((claim, index) => {
    const path = sourcePathFor(claim, index);
    const shortSha = investigation.repositorySnapshot.commitSha.slice(0, 7);
    evidence[claim.id] = [
      {
        id: `ev-${claim.id}-1`,
        claimId: claim.id,
        investigationId: investigation.id,
        type: claim.category === "testing_delivery" ? "ci_workflow" : "source_code",
        strength: claim.verdict === "verified" ? "strong" : "moderate",
        observation: `Mock repository inspection found implementation evidence related to: ${claim.normalizedInterpretation}`,
        repositoryPath: path,
        commitSha: shortSha,
        lineStart: 12 + index * 8,
        lineEnd: 28 + index * 8,
        codeExcerpt: `export function verifyClaim${index + 1}() {\n  // Deterministic mock evidence for ${investigation.project.repo}\n  return "${claim.category}" satisfies string;\n}`,
        relevance:
          "This deterministic mock evidence is scoped to the active investigation and selected claim.",
        validation: "accepted",
        discoveredBy:
          claim.category === "testing_delivery"
            ? "delivery_investigator"
            : "repository_investigator",
      },
    ];

    if (claim.verdict !== "verified") {
      evidence[claim.id].push({
        id: `ev-${claim.id}-2`,
        claimId: claim.id,
        investigationId: investigation.id,
        type: "documentation",
        strength: "weak",
        observation:
          "Supporting documentation exists, but it does not fully prove the claim without additional repository evidence.",
        repositoryPath: "README.md",
        commitSha: shortSha,
        lineStart: 40,
        lineEnd: 48,
        relevance:
          "Documentation can explain intent but is weaker than direct source, test, or runtime evidence.",
        validation: "accepted",
        discoveredBy: "skeptic_agent",
      });
    }

    proofObligations[claim.id] = [
      {
        id: `po-${claim.id}-1`,
        claimId: claim.id,
        description: "The claim maps to concrete repository evidence",
        status: claim.verdict === "verified" ? "satisfied" : "partially_satisfied",
        decisiveEvidenceId: evidence[claim.id][0].id,
      },
      {
        id: `po-${claim.id}-2`,
        claimId: claim.id,
        description: "The evidence covers the preserved qualifiers",
        status: claim.verdict === "verified" ? "satisfied" : "unknown",
      },
    ];

    judgments[claim.id] = {
      id: `jg-${claim.id}`,
      claimId: claim.id,
      verdict: claim.verdict ?? "inconclusive",
      confidence: claim.confidence ?? "low",
      summary:
        claim.verdict === "verified"
          ? "The selected claim is supported by direct mock repository evidence."
          : "The selected claim has evidence, but at least one proof obligation remains incomplete.",
      reasoning:
        "This judgment was generated deterministically from the active investigation's selected claims. It intentionally avoids using the sample report fixture.",
      unprovenAspects:
        claim.verdict === "verified"
          ? []
          : ["Additional direct repository or runtime evidence would be needed."],
      whatCouldChangeVerdict: [
        "Provide stronger source, test, CI, or runtime evidence for the unresolved obligation.",
      ],
      issuedAt: new Date().toISOString(),
    };

    challenges[claim.id] =
      claim.verdict === "verified"
        ? []
        : [
            {
              id: `ch-${claim.id}-1`,
              claimId: claim.id,
              challengedEvidenceId: evidence[claim.id][1]?.id,
              challengingAgent: "skeptic_agent",
              challengeText:
                "The available evidence does not fully cover every qualifier in the normalized claim.",
              severity: "major",
              resolution:
                "The verdict remains limited until stronger direct evidence is attached.",
              verdictChanged: false,
            },
          ];

    evidenceGaps[claim.id] =
      claim.verdict === "verified"
        ? []
        : [
            {
              id: `gap-${claim.id}-1`,
              claimId: claim.id,
              description: "The selected claim still has an unresolved evidence gap.",
              source: "mock-investigation",
              unavailableReason:
                "The frontend prototype does not inspect a real repository yet.",
              impactOnVerdict: "Confidence remains limited until backend evidence exists.",
            },
          ];

    maintainerActions[claim.id] =
      claim.verdict === "verified"
        ? []
        : [
            "Attach stronger source, test, or CI evidence for the unresolved qualifier.",
            "Document the implementation path in the repository so reviewers can trace it.",
          ];
  });

  return {
    id: `rpt-${investigation.id}`,
    investigationId: investigation.id,
    projectName: investigation.project.name,
    repositorySnapshot: investigation.repositorySnapshot,
    submissionType: investigation.submission.type,
    investigationDate: new Date().toISOString(),
    durationSeconds: Math.max(elapsedSeconds, 1),
    claimsInvestigated: completedClaims.length,
    verified: count(completedClaims, "verified"),
    partiallyVerified: count(completedClaims, "partially_verified"),
    unverified: count(completedClaims, "unverified"),
    contradicted: count(completedClaims, "contradicted"),
    inconclusive: count(completedClaims, "inconclusive"),
    overallCoverage: completedClaims.length === 0 ? 0 : 68,
    summarySentence:
      completedClaims.length === 0
        ? "No claims were selected for investigation."
        : `${completedClaims.length} selected claim${completedClaims.length === 1 ? "" : "s"} were investigated for ${investigation.project.owner}/${investigation.project.repo}.`,
    criticalFindings: completedClaims
      .filter((claim) => claim.requiresHumanReview)
      .map((claim) => `${claim.originalStatement} still requires stronger evidence.`),
    coverage: {
      sourceCode: "partial",
      documentation: "partial",
      tests: "partial",
      ciWorkflows: investigation.repositorySnapshot.hasWorkflows ? "partial" : "unavailable",
      pullRequests: "unavailable",
      branchProtection: "unavailable",
      runtimeDeployment: "unavailable",
      cloudRecords: "unavailable",
    },
    claims: completedClaims,
    judgments,
    evidence,
    proofObligations,
    challenges,
    evidenceGaps,
    maintainerActions,
  };
}

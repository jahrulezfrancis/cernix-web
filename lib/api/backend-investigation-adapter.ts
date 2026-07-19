import type {
  BackendLifecycleStatus,
  InvestigationReportResponse,
  InvestigationResponse,
  InvestigationSummary,
} from "@/lib/contracts/investigation-api";
import type { JudgeArtifact } from "@/lib/contracts/judgment-report";
import { InvestigationPlanArtifactSchema } from "@/lib/contracts/investigation-plan";
import { SkepticArtifactSchema } from "@/lib/contracts/skeptic-challenge";
import { InvestigationEvidenceBundleSchema } from "@/lib/contracts/report-enrichment";
import {
  mapArtifactLimitationsToGaps,
  mapEvidenceBundleToReport,
  mapPlanArtifactToObligations,
  mapSkepticArtifactToChallenges,
  mergeEvidenceGaps,
} from "@/lib/api/report-enrichment-adapter";
import { continuationRoute } from "@/lib/investigation-lifecycle";
import type {
  Claim,
  Investigation,
  InvestigationStatus,
  Report,
  SubmissionType,
  Verdict,
} from "@/lib/types";

const EMPTY_SNAPSHOT = {
  owner: "",
  repo: "",
  branch: "main",
  commitSha: "0000000000000000000000000000000000000000",
  primaryLanguage: "Unknown",
  languages: [],
  sizeKb: 0,
  fileCount: 0,
  hasTests: false,
  hasWorkflows: false,
  snapshotAt: new Date(0).toISOString(),
};

export function mapBackendStatus(status: BackendLifecycleStatus): InvestigationStatus {
  switch (status) {
    case "snapshotting":
    case "planning":
      return "investigating";
    case "challenging":
      return "challenged";
    default:
      return status;
  }
}

export function backendContinuationRoute(
  id: string,
  status: BackendLifecycleStatus,
  hasReport: boolean,
): string {
  if ((status === "completed" || status === "completed_with_limitations") && hasReport) {
    return `/investigations/${id}/report`;
  }
  if (status === "awaiting_claim_review") return `/investigations/${id}/claims`;
  return `/investigations/${id}/live`;
}

function backendClaim(response: InvestigationResponse): Claim {
  return {
    id: response.claim.id,
    investigationId: response.id,
    originalStatement: response.claim.statement,
    normalizedInterpretation: response.claim.statement,
    category: "implementation",
    criticality: "medium",
    verifiability: "verifiable",
    preservedQualifiers: response.claim.preservedQualifiers,
    selected: true,
    status: mapBackendClaimStatus(response.status),
    evidenceCount: 0,
    openLimitations: 0,
    requiresHumanReview: false,
  };
}

function mapBackendClaimStatus(status: BackendLifecycleStatus): Claim["status"] {
  switch (status) {
    case "snapshotting":
    case "planning":
      return "planning";
    case "investigating":
      return "investigating";
    case "challenging":
      return "challenged";
    case "reinvestigating":
      return "reinvestigating";
    case "judging":
      return "judging";
    case "completed":
    case "completed_with_limitations":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

export function investigationResponseToUi(
  response: InvestigationResponse,
  options: { hasReport?: boolean } = {},
): Investigation {
  const snapshot = {
    ...EMPTY_SNAPSHOT,
    owner: response.repository.owner,
    repo: response.repository.name,
    branch: response.repository.requestedRef ?? "main",
    snapshotAt: response.createdAt,
  };
  return {
    id: response.id,
    project: {
      id: response.id,
      name: `${response.repository.owner}/${response.repository.name}`,
      repositoryUrl: response.repository.canonicalUrl,
      owner: response.repository.owner,
      repo: response.repository.name,
      description: response.claim.statement,
    },
    repositorySnapshot: snapshot,
    submission: {
      id: `${response.id}-submission`,
      projectId: response.id,
      type: "technical_due_diligence" satisfies SubmissionType,
      content: response.claim.statement,
      submittedAt: response.createdAt,
    },
    status: mapBackendStatus(response.status),
    claims: [backendClaim(response)],
    agentRuns: [],
    workflowStages: [],
    startedAt: response.startedAt ?? undefined,
    completedAt: response.completedAt ?? undefined,
    requiresHumanReview: false,
    report: options.hasReport ? ({ id: response.id } as Report) : undefined,
  };
}

export function investigationSummaryToUi(summary: InvestigationSummary): Investigation {
  const snapshot = {
    ...EMPTY_SNAPSHOT,
    owner: summary.repository.owner,
    repo: summary.repository.name,
    branch: summary.repository.requestedRef ?? "main",
    snapshotAt: summary.createdAt,
  };
  return {
    id: summary.id,
    project: {
      id: summary.id,
      name: `${summary.repository.owner}/${summary.repository.name}`,
      repositoryUrl: summary.repository.canonicalUrl,
      owner: summary.repository.owner,
      repo: summary.repository.name,
      description: summary.claimStatement,
    },
    repositorySnapshot: snapshot,
    submission: {
      id: `${summary.id}-submission`,
      projectId: summary.id,
      type: "technical_due_diligence",
      content: summary.claimStatement,
      submittedAt: summary.createdAt,
    },
    status: mapBackendStatus(summary.status),
    claims: [{
      id: `${summary.id}-claim`,
      investigationId: summary.id,
      originalStatement: summary.claimStatement,
      normalizedInterpretation: summary.claimStatement,
      category: "implementation",
      criticality: "medium",
      verifiability: "verifiable",
      preservedQualifiers: [],
      selected: true,
      status: mapBackendClaimStatus(summary.status),
      evidenceCount: 0,
      openLimitations: 0,
      requiresHumanReview: false,
    }],
    agentRuns: [],
    workflowStages: [],
    startedAt: summary.startedAt ?? undefined,
    completedAt: summary.completedAt ?? undefined,
    requiresHumanReview: false,
    report: summary.hasReport ? { id: summary.id } as Report : undefined,
  };
}

export function dashboardRouteForSummary(summary: InvestigationSummary): string | null {
  if (summary.status === "failed") return null;
  return backendContinuationRoute(summary.id, summary.status, summary.hasReport);
}

export function judgeArtifactToReport(
  investigation: InvestigationResponse,
  persisted: InvestigationReportResponse,
): Report {
  const artifact = persisted.artifact as JudgeArtifact;
  return buildReportFromArtifact(investigation, artifact, persisted);
}

export function buildReportFromArtifact(
  investigation: InvestigationResponse,
  artifact: JudgeArtifact,
  persisted: Pick<
    InvestigationReportResponse,
    | "artifactHashSha256"
    | "completionDisposition"
    | "snapshotManifestHash"
    | "evidenceBundle"
    | "skepticAnalysis"
    | "investigationPlan"
  > & { artifactHashSha256: string },
): Report {
  const verdictCounts = {
    verified: 0,
    partiallyVerified: 0,
    unverified: 0,
    contradicted: 0,
    inconclusive: 0,
  };
  const claims = artifact.claimJudgments.map((judgment) => {
    const verdict = judgment.verdict as Verdict;
    if (verdict === "verified") verdictCounts.verified += 1;
    else if (verdict === "partially_verified") verdictCounts.partiallyVerified += 1;
    else verdictCounts.unverified += 1;
    return {
      id: judgment.claimId,
      investigationId: investigation.id,
      originalStatement: investigation.claim.statement,
      normalizedInterpretation: investigation.claim.statement,
      category: "implementation" as const,
      criticality: "medium" as const,
      verifiability: "verifiable" as const,
      preservedQualifiers: investigation.claim.preservedQualifiers,
      selected: true,
      status: "completed" as const,
      verdict,
      confidence: judgment.confidence,
      evidenceCount: judgment.confidenceFactors.length,
      openLimitations: artifact.limitations.filter((item) => item.claimId === judgment.claimId).length,
      requiresHumanReview: false,
    };
  });
  const judgments = Object.fromEntries(artifact.claimJudgments.map((judgment) => [judgment.claimId, {
    id: judgment.id,
    claimId: judgment.claimId,
    verdict: judgment.verdict as Verdict,
    confidence: judgment.confidence,
    summary: judgment.summary,
    reasoning: judgment.reasoning,
    unprovenAspects: judgment.unprovenAspects,
    whatCouldChangeVerdict: judgment.whatCouldChangeVerdict,
    confidenceFactors: judgment.confidenceFactors,
    issuedAt: investigation.completedAt ?? investigation.updatedAt,
  }]));
  const maintainerActions = Object.fromEntries(artifact.claimJudgments.map((judgment) => [
    judgment.claimId,
    artifact.maintainerActions.filter((action) => action.claimId === judgment.claimId).map((action) => action.action),
  ]));

  const evidenceBundle = persisted.evidenceBundle
    ? InvestigationEvidenceBundleSchema.parse(persisted.evidenceBundle)
    : undefined;
  const skepticArtifact = persisted.skepticAnalysis
    ? SkepticArtifactSchema.parse(persisted.skepticAnalysis)
    : null;
  const planArtifact = persisted.investigationPlan
    ? InvestigationPlanArtifactSchema.parse(persisted.investigationPlan)
    : null;

  const mappedEvidence = mapEvidenceBundleToReport(evidenceBundle, investigation.id);
  const mappedGaps = mergeEvidenceGaps(
    mappedEvidence.evidenceGaps,
    mapArtifactLimitationsToGaps(artifact.limitations),
  );

  const verifiedRate = claims.length
    ? Math.round((verdictCounts.verified / claims.length) * 100)
    : 0;

  return {
    id: persisted.artifactHashSha256,
    investigationId: investigation.id,
    projectName: `${investigation.repository.owner}/${investigation.repository.name}`,
    repositorySnapshot: {
      owner: investigation.repository.owner,
      repo: investigation.repository.name,
      branch: investigation.repository.requestedRef ?? "main",
      commitSha: artifact.commitSha,
      primaryLanguage: "Unknown",
      languages: [],
      sizeKb: 0,
      fileCount: 0,
      hasTests: false,
      hasWorkflows: false,
      snapshotAt: investigation.startedAt ?? investigation.createdAt,
    },
    submissionType: "technical_due_diligence",
    investigationDate: investigation.startedAt ?? investigation.createdAt,
    durationSeconds: investigation.completedAt && investigation.startedAt
      ? Math.max(0, Math.round((Date.parse(investigation.completedAt) - Date.parse(investigation.startedAt)) / 1000))
      : 0,
    claimsInvestigated: claims.length,
    verified: verdictCounts.verified,
    partiallyVerified: verdictCounts.partiallyVerified,
    unverified: verdictCounts.unverified,
    contradicted: verdictCounts.contradicted,
    inconclusive: verdictCounts.inconclusive,
    overallCoverage: verifiedRate,
    summarySentence: artifact.reportSummary,
    criticalFindings: artifact.limitations.map((item) => item.description),
    coverage: {
      sourceCode: evidenceBundle?.tasks.some((task) => task.candidates.length > 0) ? "partial" : "unavailable",
      documentation: "unavailable",
      tests: "unavailable",
      ciWorkflows: "unavailable",
      pullRequests: "unavailable",
      branchProtection: "unavailable",
      runtimeDeployment: "unavailable",
      cloudRecords: "unavailable",
    },
    claims,
    judgments,
    evidence: mappedEvidence.evidence,
    proofObligations: mapPlanArtifactToObligations(planArtifact),
    challenges: mapSkepticArtifactToChallenges(skepticArtifact),
    evidenceGaps: mappedGaps,
    maintainerActions,
    completionDisposition: persisted.completionDisposition,
    artifactHashSha256: persisted.artifactHashSha256,
    snapshotManifestHash: persisted.snapshotManifestHash,
  };
}

export function legacyContinuationRoute(id: string, status: InvestigationStatus, hasReport = false) {
  return continuationRoute(id, status, hasReport);
}

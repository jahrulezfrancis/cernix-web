import type { Claim, Investigation, InvestigationSimulationState, Report } from "./types";

export const STORAGE_VERSION = 1;
export const MAX_SELECTED_CLAIMS = 5;
export const MAX_SIMULATION_STEP = 6;

const statuses = new Set(["draft", "extracting_claims", "awaiting_claim_review", "investigating", "challenged", "reinvestigating", "judging", "completed", "completed_with_limitations", "failed", "awaiting_review"]);
const claimStatuses = new Set(["queued", "planning", "investigating", "challenged", "reinvestigating", "judging", "completed", "failed"]);
const categories = new Set(["implementation", "architecture", "quality", "security_privacy", "testing_delivery", "maintenance_governance", "milestone_completion", "performance_outcome"]);
const criticalities = new Set(["critical", "high", "medium", "low"]);
const verifiabilities = new Set(["verifiable", "partially_verifiable", "not_verifiable"]);
const submissionTypes = new Set(["hackathon_submission", "grant_application", "milestone_report", "technical_due_diligence", "repository_documentation", "other"]);
const coverageStatuses = new Set(["complete", "partial", "unavailable"]);
const runStatuses = new Set(["queued", "running", "completed", "failed"]);
const stageStatuses = new Set(["completed", "active", "pending", "failed", "blocked"]);

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);

export function validateClaim(value: unknown, investigationId: string): value is Claim {
  return object(value) && typeof value.id === "string" && value.investigationId === investigationId &&
    typeof value.originalStatement === "string" && typeof value.normalizedInterpretation === "string" &&
    categories.has(String(value.category)) && criticalities.has(String(value.criticality)) &&
    verifiabilities.has(String(value.verifiability)) && strings(value.preservedQualifiers) &&
    typeof value.selected === "boolean" && claimStatuses.has(String(value.status)) &&
    finite(value.evidenceCount) && finite(value.openLimitations) && typeof value.requiresHumanReview === "boolean";
}

export function validateSimulation(value: unknown): value is InvestigationSimulationState {
  if (!object(value) || !Number.isInteger(value.stepIndex) || Number(value.stepIndex) < 0 || Number(value.stepIndex) > MAX_SIMULATION_STEP || !finite(value.elapsedSeconds) || Number(value.elapsedSeconds) < 0 || typeof value.running !== "boolean" || !strings(value.visibleEventIds) || typeof value.completed !== "boolean" || typeof value.updatedAt !== "string") return false;
  return value.completed
    ? Number(value.stepIndex) === MAX_SIMULATION_STEP && value.running === false
    : Number(value.stepIndex) < MAX_SIMULATION_STEP;
}

function validateSnapshot(value: unknown) {
  return object(value) && typeof value.owner === "string" && typeof value.repo === "string" &&
    typeof value.branch === "string" && typeof value.commitSha === "string" &&
    typeof value.primaryLanguage === "string" && strings(value.languages) && finite(value.sizeKb) &&
    finite(value.fileCount) && typeof value.hasTests === "boolean" && typeof value.hasWorkflows === "boolean" &&
    typeof value.snapshotAt === "string";
}

function validateKeyedArrays(value: unknown, claimIds: Set<string>, validateItem: (item: unknown, claimId: string) => boolean) {
  if (!object(value) || Object.keys(value).length !== claimIds.size || Object.keys(value).some((key) => !claimIds.has(key))) return false;
  return [...claimIds].every((claimId) => Array.isArray(value[claimId]) && (value[claimId] as unknown[]).every((item) => validateItem(item, claimId)));
}

export function validateReport(value: unknown, investigationId: string, allowedClaimIds?: Set<string>): value is Report {
  if (!object(value) || value.id !== `rpt-${investigationId}` || value.investigationId !== investigationId ||
      typeof value.projectName !== "string" || !validateSnapshot(value.repositorySnapshot) ||
      !submissionTypes.has(String(value.submissionType)) || typeof value.investigationDate !== "string" ||
      !finite(value.durationSeconds) || !finite(value.claimsInvestigated) || !finite(value.verified) ||
      !finite(value.partiallyVerified) || !finite(value.unverified) || !finite(value.contradicted) ||
      !finite(value.inconclusive) || !finite(value.overallCoverage) || typeof value.summarySentence !== "string" ||
      !strings(value.criticalFindings) || !Array.isArray(value.claims) || value.claims.length > MAX_SELECTED_CLAIMS ||
      !value.claims.every((claim) => validateClaim(claim, investigationId) && claim.selected && (!allowedClaimIds || allowedClaimIds.has(claim.id)))) return false;

  const claims = value.claims as Claim[];
  const claimIds = new Set(claims.map((claim) => claim.id));
  if (claimIds.size !== claims.length || value.claimsInvestigated !== claims.length || !object(value.coverage) ||
      Object.keys(value.coverage).length !== 8 || Object.values(value.coverage).some((status) => !coverageStatuses.has(String(status)))) return false;
  if (!object(value.judgments) || Object.keys(value.judgments).length !== claimIds.size || [...claimIds].some((claimId) => {
    const item = (value.judgments as Record<string, unknown>)[claimId];
    return !object(item) || item.claimId !== claimId || typeof item.id !== "string" || typeof item.summary !== "string" ||
      typeof item.reasoning !== "string" || typeof item.issuedAt !== "string" || !strings(item.unprovenAspects) || !strings(item.whatCouldChangeVerdict);
  })) return false;

  return validateKeyedArrays(value.evidence, claimIds, (item, claimId) => object(item) && item.claimId === claimId && item.investigationId === investigationId && typeof item.id === "string" && typeof item.observation === "string") &&
    validateKeyedArrays(value.proofObligations, claimIds, (item, claimId) => object(item) && item.claimId === claimId && typeof item.id === "string" && typeof item.description === "string") &&
    validateKeyedArrays(value.challenges, claimIds, (item, claimId) => object(item) && item.claimId === claimId && typeof item.id === "string" && typeof item.challengeText === "string") &&
    validateKeyedArrays(value.evidenceGaps, claimIds, (item, claimId) => object(item) && item.claimId === claimId && typeof item.id === "string" && typeof item.description === "string") &&
    validateKeyedArrays(value.maintainerActions, claimIds, (item) => typeof item === "string");
}

export function validateInvestigation(value: unknown, key: string): value is Investigation {
  if (!object(value) || value.id !== key || !statuses.has(String(value.status))) return false;
  const project = value.project, snapshot = value.repositorySnapshot, submission = value.submission;
  if (!object(project) || typeof project.id !== "string" || typeof project.name !== "string" || typeof project.repositoryUrl !== "string" || typeof project.owner !== "string" || typeof project.repo !== "string" || typeof project.description !== "string") return false;
  if (!validateSnapshot(snapshot) || !object(submission) || typeof submission.id !== "string" || typeof submission.projectId !== "string" || !submissionTypes.has(String(submission.type)) || typeof submission.content !== "string" || typeof submission.submittedAt !== "string") return false;
  if (!Array.isArray(value.claims) || !value.claims.every((claim) => validateClaim(claim, key)) || value.claims.filter((claim) => claim.selected).length > MAX_SELECTED_CLAIMS || new Set(value.claims.map((claim) => claim.id)).size !== value.claims.length) return false;
  if (!Array.isArray(value.agentRuns) || !value.agentRuns.every((run) => object(run) && typeof run.id === "string" && run.investigationId === key && typeof run.role === "string" && runStatuses.has(String(run.status)) && (run.events === undefined || Array.isArray(run.events) && run.events.every((event) => object(event) && typeof event.id === "string" && event.agentRunId === run.id && typeof event.type === "string" && typeof event.description === "string" && typeof event.timestamp === "string")))) return false;
  if (!Array.isArray(value.workflowStages) || !value.workflowStages.every((stage) => object(stage) && typeof stage.id === "string" && typeof stage.label === "string" && stageStatuses.has(String(stage.status))) || typeof value.requiresHumanReview !== "boolean") return false;
  if (value.simulationState !== undefined && !validateSimulation(value.simulationState)) return false;
  const claimIds = new Set((value.claims as Claim[]).map((claim) => claim.id));
  if (value.report !== undefined && !validateReport(value.report, key, claimIds)) return false;
  return !((value.status === "completed" || value.status === "completed_with_limitations") && (!validateReport(value.report, key, claimIds) || !object(value.simulationState) || value.simulationState.completed !== true));
}

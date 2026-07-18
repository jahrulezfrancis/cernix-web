import type { Claim, Investigation, InvestigationSimulationState, Report, RepositorySnapshot } from "./types";

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
const verdicts = new Set(["verified", "partially_verified", "unverified", "contradicted", "inconclusive"]);
const confidences = new Set(["high", "moderate", "low"]);
const agentRoles = new Set(["claim_analyst", "investigation_planner", "repository_investigator", "delivery_investigator", "maintenance_investigator", "skeptic_agent", "evidence_judge"]);
const eventTypes = new Set(["evidence_validated", "proof_obligation_satisfied", "contradiction_discovered", "evidence_rejected", "reinvestigation_requested", "claim_sent_to_judgment", "human_input_required"]);
const proofStatuses = new Set(["satisfied", "partially_satisfied", "unsatisfied", "unknown"]);
const evidenceTypes = new Set(["source_code", "configuration", "test", "ci_workflow", "documentation", "commit_history", "pull_request", "dependency", "deployment_manifest", "branch_protection", "runtime_artifact"]);
const evidenceStrengths = new Set(["strong", "moderate", "weak", "inconclusive"]);
const evidenceValidations = new Set(["accepted", "rejected", "pending", "contested"]);
const challengeSeverities = new Set(["critical", "major", "minor"]);
const coverageKeys = ["sourceCode", "documentation", "tests", "ciWorkflows", "pullRequests", "branchProtection", "runtimeDeployment", "cloudRecords"];

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const nonNegativeInteger = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
const optionalString = (value: unknown) => value === undefined || typeof value === "string";
const uniqueStrings = (value: string[]) => new Set(value).size === value.length;

export function validateClaim(value: unknown, investigationId: string): value is Claim {
  return object(value) && typeof value.id === "string" && value.investigationId === investigationId &&
    typeof value.originalStatement === "string" && typeof value.normalizedInterpretation === "string" &&
    categories.has(String(value.category)) && criticalities.has(String(value.criticality)) &&
    verifiabilities.has(String(value.verifiability)) && strings(value.preservedQualifiers) &&
    typeof value.selected === "boolean" && claimStatuses.has(String(value.status)) &&
    (value.verdict === undefined || verdicts.has(String(value.verdict))) &&
    (value.confidence === undefined || confidences.has(String(value.confidence))) &&
    optionalString(value.parentId) && (value.childIds === undefined || strings(value.childIds) && uniqueStrings(value.childIds)) &&
    nonNegativeInteger(value.evidenceCount) && nonNegativeInteger(value.openLimitations) && typeof value.requiresHumanReview === "boolean";
}

export function validateSimulation(value: unknown): value is InvestigationSimulationState {
  if (!object(value) || !Number.isInteger(value.stepIndex) || Number(value.stepIndex) < 0 || Number(value.stepIndex) > MAX_SIMULATION_STEP || !finite(value.elapsedSeconds) || Number(value.elapsedSeconds) < 0 || typeof value.running !== "boolean" || !strings(value.visibleEventIds) || typeof value.completed !== "boolean" || typeof value.updatedAt !== "string") return false;
  return value.completed
    ? Number(value.stepIndex) === MAX_SIMULATION_STEP && value.running === false
    : Number(value.stepIndex) < MAX_SIMULATION_STEP;
}

function validateSnapshot(value: unknown): value is RepositorySnapshot {
  return object(value) && typeof value.owner === "string" && typeof value.repo === "string" &&
    typeof value.branch === "string" && typeof value.commitSha === "string" &&
    typeof value.primaryLanguage === "string" && strings(value.languages) && uniqueStrings(value.languages) && nonNegativeInteger(value.sizeKb) &&
    nonNegativeInteger(value.fileCount) && typeof value.hasTests === "boolean" && typeof value.hasWorkflows === "boolean" &&
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
      !nonNegativeInteger(value.durationSeconds) || !nonNegativeInteger(value.claimsInvestigated) || !nonNegativeInteger(value.verified) ||
      !nonNegativeInteger(value.partiallyVerified) || !nonNegativeInteger(value.unverified) || !nonNegativeInteger(value.contradicted) ||
      !nonNegativeInteger(value.inconclusive) || !finite(value.overallCoverage) || Number(value.overallCoverage) < 0 || Number(value.overallCoverage) > 100 || typeof value.summarySentence !== "string" ||
      !strings(value.criticalFindings) || !Array.isArray(value.claims) || value.claims.length > MAX_SELECTED_CLAIMS ||
      !value.claims.every((claim) => validateClaim(claim, investigationId) && claim.selected && (!allowedClaimIds || allowedClaimIds.has(claim.id)))) return false;

  const claims = value.claims as Claim[];
  const claimIds = new Set(claims.map((claim) => claim.id));
  const verdictCount = (verdict: string) => claims.filter((claim) => claim.verdict === verdict).length;
  if (claimIds.size !== claims.length || value.claimsInvestigated !== claims.length ||
      value.verified !== verdictCount("verified") || value.partiallyVerified !== verdictCount("partially_verified") ||
      value.unverified !== verdictCount("unverified") || value.contradicted !== verdictCount("contradicted") ||
      value.inconclusive !== verdictCount("inconclusive") || claims.some((claim) => claim.status !== "completed" || !claim.verdict || !claim.confidence) ||
      !object(value.coverage) || Object.keys(value.coverage).length !== coverageKeys.length ||
      coverageKeys.some((key) => !coverageStatuses.has(String((value.coverage as Record<string, unknown>)[key])))) return false;
  if (!object(value.judgments) || Object.keys(value.judgments).length !== claimIds.size || [...claimIds].some((claimId) => {
    const item = (value.judgments as Record<string, unknown>)[claimId];
    const claim = claims.find((candidate) => candidate.id === claimId);
    return !object(item) || item.claimId !== claimId || item.id !== `jg-${claimId}` ||
      !verdicts.has(String(item.verdict)) || !confidences.has(String(item.confidence)) ||
      item.verdict !== claim?.verdict || item.confidence !== claim?.confidence ||
      typeof item.summary !== "string" || typeof item.reasoning !== "string" || typeof item.issuedAt !== "string" ||
      !strings(item.unprovenAspects) || !strings(item.whatCouldChangeVerdict);
  })) return false;

  const evidenceIds = new Set<string>();
  const seenIds = new Set<string>(Object.values(value.judgments as Record<string, { id: string }>).map((item) => item.id));
  const registerId = (id: unknown) => typeof id === "string" && !seenIds.has(id) && (seenIds.add(id), true);
  const validEvidence = validateKeyedArrays(value.evidence, claimIds, (item, claimId) => {
    if (!object(item) || !registerId(item.id) || item.claimId !== claimId || item.investigationId !== investigationId ||
        !evidenceTypes.has(String(item.type)) || !evidenceStrengths.has(String(item.strength)) ||
        !evidenceValidations.has(String(item.validation)) || !agentRoles.has(String(item.discoveredBy)) ||
        typeof item.observation !== "string" || typeof item.relevance !== "string" || !optionalString(item.repositoryPath) ||
        !optionalString(item.commitSha) || !optionalString(item.codeExcerpt) ||
        (item.lineStart !== undefined && !nonNegativeInteger(item.lineStart)) ||
        (item.lineEnd !== undefined && !nonNegativeInteger(item.lineEnd))) return false;
    evidenceIds.add(item.id as string);
    return true;
  });
  return validEvidence &&
    validateKeyedArrays(value.proofObligations, claimIds, (item, claimId) => object(item) && registerId(item.id) &&
      item.claimId === claimId && typeof item.description === "string" && proofStatuses.has(String(item.status)) &&
      (item.decisiveEvidenceId === undefined || typeof item.decisiveEvidenceId === "string" && evidenceIds.has(item.decisiveEvidenceId))) &&
    validateKeyedArrays(value.challenges, claimIds, (item, claimId) => object(item) && registerId(item.id) &&
      item.claimId === claimId && agentRoles.has(String(item.challengingAgent)) && typeof item.challengeText === "string" &&
      challengeSeverities.has(String(item.severity)) && typeof item.verdictChanged === "boolean" &&
      optionalString(item.resolution) && optionalString(item.challengedFindingId) &&
      (item.challengedEvidenceId === undefined || typeof item.challengedEvidenceId === "string" && evidenceIds.has(item.challengedEvidenceId)) &&
      (item.verdictBefore === undefined || verdicts.has(String(item.verdictBefore))) &&
      (item.verdictAfter === undefined || verdicts.has(String(item.verdictAfter)))) &&
    validateKeyedArrays(value.evidenceGaps, claimIds, (item, claimId) => object(item) && registerId(item.id) &&
      item.claimId === claimId && typeof item.description === "string" && typeof item.source === "string" &&
      typeof item.unavailableReason === "string" && typeof item.impactOnVerdict === "string") &&
    validateKeyedArrays(value.maintainerActions, claimIds, (item) => typeof item === "string");
}

function sameSnapshot(left: Investigation["repositorySnapshot"], right: Report["repositorySnapshot"]) {
  return left.owner === right.owner && left.repo === right.repo && left.branch === right.branch &&
    left.commitSha === right.commitSha && left.primaryLanguage === right.primaryLanguage &&
    left.sizeKb === right.sizeKb && left.fileCount === right.fileCount && left.hasTests === right.hasTests &&
    left.hasWorkflows === right.hasWorkflows && left.snapshotAt === right.snapshotAt &&
    left.languages.length === right.languages.length && left.languages.every((language, index) => language === right.languages[index]);
}

function sameClaimIdentity(left: Claim, right: Claim) {
  return left.id === right.id && left.investigationId === right.investigationId &&
    left.originalStatement === right.originalStatement && left.normalizedInterpretation === right.normalizedInterpretation &&
    left.category === right.category && left.criticality === right.criticality && left.verifiability === right.verifiability &&
    left.selected === right.selected && left.parentId === right.parentId &&
    JSON.stringify(left.childIds ?? []) === JSON.stringify(right.childIds ?? []) &&
    JSON.stringify(left.preservedQualifiers) === JSON.stringify(right.preservedQualifiers);
}

export function validateReportForInvestigation(value: unknown, investigation: Investigation): value is Report {
  const selectedClaims = investigation.claims.filter((claim) => claim.selected);
  const selectedIds = new Set(selectedClaims.map((claim) => claim.id));
  if (!validateReport(value, investigation.id, selectedIds) || value.projectName !== investigation.project.name ||
      value.submissionType !== investigation.submission.type || !sameSnapshot(investigation.repositorySnapshot, value.repositorySnapshot) ||
      value.claims.length !== selectedClaims.length) return false;
  const reportClaims = new Map(value.claims.map((claim) => [claim.id, claim]));
  return selectedClaims.every((claim) => {
    const reportClaim = reportClaims.get(claim.id);
    return !!reportClaim && sameClaimIdentity(claim, reportClaim);
  });
}

export function validateInvestigation(value: unknown, key: string): value is Investigation {
  if (!object(value) || value.id !== key || !statuses.has(String(value.status))) return false;
  const project = value.project, snapshot = value.repositorySnapshot, submission = value.submission;
  if (!object(project) || typeof project.id !== "string" || typeof project.name !== "string" || typeof project.repositoryUrl !== "string" || typeof project.owner !== "string" || typeof project.repo !== "string" || typeof project.description !== "string") return false;
  if (!validateSnapshot(snapshot) || snapshot.owner !== project.owner || snapshot.repo !== project.repo ||
      !object(submission) || typeof submission.id !== "string" || submission.projectId !== project.id ||
      !submissionTypes.has(String(submission.type)) || typeof submission.content !== "string" ||
      !optionalString(submission.focusQuestion) || typeof submission.submittedAt !== "string") return false;
  if (!Array.isArray(value.claims) || !value.claims.every((claim) => validateClaim(claim, key)) || value.claims.filter((claim) => claim.selected).length > MAX_SELECTED_CLAIMS || new Set(value.claims.map((claim) => claim.id)).size !== value.claims.length) return false;
  const claimIds = new Set((value.claims as Claim[]).map((claim) => claim.id));
  if ((value.claims as Claim[]).some((claim) => (claim.parentId !== undefined && !claimIds.has(claim.parentId)) ||
      (claim.childIds ?? []).some((childId) => !claimIds.has(childId)))) return false;
  if (!Array.isArray(value.agentRuns) || new Set(value.agentRuns.map((run) => object(run) ? run.id : undefined)).size !== value.agentRuns.length ||
      !value.agentRuns.every((run) => object(run) && typeof run.id === "string" && run.investigationId === key &&
      (run.claimId === undefined || typeof run.claimId === "string" && claimIds.has(run.claimId)) &&
      agentRoles.has(String(run.role)) && runStatuses.has(String(run.status)) &&
      (run.events === undefined || Array.isArray(run.events) && new Set(run.events.map((event) => object(event) ? event.id : undefined)).size === run.events.length &&
      run.events.every((event) => object(event) && typeof event.id === "string" && event.agentRunId === run.id &&
      eventTypes.has(String(event.type)) && typeof event.description === "string" && typeof event.timestamp === "string" &&
      (event.relatedClaimId === undefined || typeof event.relatedClaimId === "string" && claimIds.has(event.relatedClaimId)))))) return false;
  if (!Array.isArray(value.workflowStages) || !value.workflowStages.every((stage) => object(stage) && typeof stage.id === "string" && typeof stage.label === "string" && stageStatuses.has(String(stage.status))) || typeof value.requiresHumanReview !== "boolean") return false;
  if (value.simulationState !== undefined && !validateSimulation(value.simulationState)) return false;
  const completed = value.status === "completed" || value.status === "completed_with_limitations";
  if (completed) return validateReportForInvestigation(value.report, value as unknown as Investigation) && object(value.simulationState) && value.simulationState.completed === true;
  return value.report === undefined;
}

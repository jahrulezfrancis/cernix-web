// ─── Core Enumerations ───────────────────────────────────────────────────────

export type Verdict =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "contradicted"
  | "inconclusive";

export type Confidence = "high" | "moderate" | "low";

export type Criticality = "critical" | "high" | "medium" | "low";

export type Verifiability = "verifiable" | "partially_verifiable" | "not_verifiable";

export type SubmissionType =
  | "hackathon_submission"
  | "grant_application"
  | "milestone_report"
  | "technical_due_diligence"
  | "repository_documentation"
  | "other";

export type ClaimCategory =
  | "implementation"
  | "architecture"
  | "quality"
  | "security_privacy"
  | "testing_delivery"
  | "maintenance_governance"
  | "milestone_completion"
  | "performance_outcome";

export type AgentRole =
  | "claim_analyst"
  | "investigation_planner"
  | "repository_investigator"
  | "delivery_investigator"
  | "maintenance_investigator"
  | "skeptic_agent"
  | "evidence_judge";

export type InvestigationStatus =
  | "draft"
  | "extracting_claims"
  | "awaiting_claim_review"
  | "investigating"
  | "challenged"
  | "reinvestigating"
  | "judging"
  | "completed"
  | "completed_with_limitations"
  | "failed"
  | "awaiting_review";

export type ClaimStatus =
  | "queued"
  | "planning"
  | "investigating"
  | "challenged"
  | "reinvestigating"
  | "judging"
  | "completed"
  | "failed";

export type ProofObligationStatus =
  | "satisfied"
  | "partially_satisfied"
  | "unsatisfied"
  | "unknown";

export type EvidenceType =
  | "source_code"
  | "configuration"
  | "test"
  | "ci_workflow"
  | "documentation"
  | "commit_history"
  | "pull_request"
  | "dependency"
  | "deployment_manifest"
  | "branch_protection"
  | "runtime_artifact";

export type EvidenceStrength = "strong" | "moderate" | "weak" | "inconclusive";

export type EvidenceValidation = "accepted" | "rejected" | "pending" | "contested";

export type CoverageStatus = "complete" | "partial" | "unavailable";

export type WorkflowStageStatus =
  | "completed"
  | "active"
  | "pending"
  | "failed"
  | "blocked";

// ─── Core Entities ────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  repositoryUrl: string;
  owner: string;
  repo: string;
  description: string;
}

export interface RepositorySnapshot {
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  primaryLanguage: string;
  languages: string[];
  sizeKb: number;
  fileCount: number;
  hasTests: boolean;
  hasWorkflows: boolean;
  snapshotAt: string;
}

export interface Submission {
  id: string;
  projectId: string;
  type: SubmissionType;
  content: string;
  focusQuestion?: string;
  submittedAt: string;
}

export interface Claim {
  id: string;
  investigationId: string;
  originalStatement: string;
  normalizedInterpretation: string;
  category: ClaimCategory;
  criticality: Criticality;
  verifiability: Verifiability;
  preservedQualifiers: string[];
  parentId?: string;
  childIds?: string[];
  selected: boolean;
  status: ClaimStatus;
  verdict?: Verdict;
  confidence?: Confidence;
  evidenceCount: number;
  openLimitations: number;
  requiresHumanReview: boolean;
}

export interface ProofObligation {
  id: string;
  claimId: string;
  description: string;
  status: ProofObligationStatus;
  decisiveEvidenceId?: string;
}

export interface Evidence {
  id: string;
  claimId: string;
  investigationId: string;
  type: EvidenceType;
  strength: EvidenceStrength;
  observation: string;
  repositoryPath?: string;
  commitSha?: string;
  lineStart?: number;
  lineEnd?: number;
  codeExcerpt?: string;
  relevance: string;
  validation: EvidenceValidation;
  discoveredBy: AgentRole;
}

export interface EvidenceGap {
  id: string;
  claimId: string;
  description: string;
  source: string;
  unavailableReason: string;
  impactOnVerdict: string;
}

export interface Challenge {
  id: string;
  claimId: string;
  challengedEvidenceId?: string;
  challengedFindingId?: string;
  challengingAgent: AgentRole;
  challengeText: string;
  severity: "critical" | "major" | "minor";
  resolution?: string;
  verdictChanged: boolean;
  verdictBefore?: Verdict;
  verdictAfter?: Verdict;
}

export interface Finding {
  id: string;
  claimId: string;
  agentRole: AgentRole;
  summary: string;
  detail: string;
  verdict: Verdict;
  confidence: Confidence;
}

export interface Judgment {
  id: string;
  claimId: string;
  verdict: Verdict;
  confidence: Confidence;
  summary: string;
  reasoning: string;
  unprovenAspects: string[];
  whatCouldChangeVerdict: string[];
  issuedAt: string;
}

export interface AgentRun {
  id: string;
  investigationId: string;
  claimId?: string;
  role: AgentRole;
  status: "queued" | "running" | "completed" | "failed";
  currentTask?: string;
  filesInspected?: string[];
  evidenceCollected?: number;
  proofObligationsEvaluated?: number;
  startedAt?: string;
  completedAt?: string;
  events?: AgentEvent[];
}

export interface AgentEvent {
  id: string;
  agentRunId: string;
  type:
    | "evidence_validated"
    | "proof_obligation_satisfied"
    | "contradiction_discovered"
    | "evidence_rejected"
    | "reinvestigation_requested"
    | "claim_sent_to_judgment"
    | "human_input_required";
  description: string;
  timestamp: string;
  relatedEvidenceId?: string;
  relatedClaimId?: string;
}

export interface WorkflowStage {
  id: string;
  label: string;
  status: WorkflowStageStatus;
  completedAt?: string;
}

export interface InvestigationCoverage {
  sourceCode: CoverageStatus;
  documentation: CoverageStatus;
  tests: CoverageStatus;
  ciWorkflows: CoverageStatus;
  pullRequests: CoverageStatus;
  branchProtection: CoverageStatus;
  runtimeDeployment: CoverageStatus;
  cloudRecords: CoverageStatus;
}

export interface Report {
  id: string;
  investigationId: string;
  projectName: string;
  repositorySnapshot: RepositorySnapshot;
  submissionType: SubmissionType;
  investigationDate: string;
  durationSeconds: number;
  claimsInvestigated: number;
  verified: number;
  partiallyVerified: number;
  unverified: number;
  contradicted: number;
  inconclusive: number;
  overallCoverage: number;
  summarySentence: string;
  criticalFindings: string[];
  coverage: InvestigationCoverage;
  claims: Claim[];
  judgments: Record<string, Judgment>;
  evidence: Record<string, Evidence[]>;
  proofObligations: Record<string, ProofObligation[]>;
  challenges: Record<string, Challenge[]>;
  evidenceGaps: Record<string, EvidenceGap[]>;
  maintainerActions: Record<string, string[]>;
}

export interface Investigation {
  id: string;
  project: Project;
  repositorySnapshot: RepositorySnapshot;
  submission: Submission;
  status: InvestigationStatus;
  claims: Claim[];
  agentRuns: AgentRun[];
  workflowStages: WorkflowStage[];
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  requiresHumanReview: boolean;
  report?: Report;
  simulationState?: InvestigationSimulationState;
}

export interface InvestigationSimulationState {
  stepIndex: number;
  elapsedSeconds: number;
  running: boolean;
  visibleEventIds: string[];
  completed: boolean;
  updatedAt: string;
}

import type { InvestigationPlanArtifact } from "@/lib/contracts/investigation-plan";
import type { InvestigationReportResponse } from "@/lib/contracts/investigation-api";
import type { SkepticArtifact } from "@/lib/contracts/skeptic-challenge";
import type {
  AgentRole,
  Challenge,
  Evidence,
  EvidenceGap,
  EvidenceStrength,
  EvidenceType,
  ProofObligation,
} from "@/lib/types";
import type { InvestigationEvidenceBundle } from "@/lib/contracts/report-enrichment";

const SPECIALIST_TO_AGENT: Record<string, AgentRole> = {
  repository_investigator: "repository_investigator",
  security: "repository_investigator",
  testing: "delivery_investigator",
  database_lifecycle: "maintenance_investigator",
  dependencies: "maintenance_investigator",
  architecture_documentation: "repository_investigator",
  reliability: "delivery_investigator",
};

const EVIDENCE_TYPE_MAP: Record<string, EvidenceType> = {
  repository_structure: "source_code",
  source_code: "source_code",
  configuration: "configuration",
  test: "test",
  ci_workflow: "ci_workflow",
  documentation: "documentation",
  commit_history: "commit_history",
  pull_request: "pull_request",
  dependency: "dependency",
  deployment_manifest: "deployment_manifest",
  branch_protection: "branch_protection",
  runtime_artifact: "runtime_artifact",
};

function mapEvidenceType(value: string): EvidenceType {
  return EVIDENCE_TYPE_MAP[value] ?? "source_code";
}

function mapStrength(value: string): EvidenceStrength {
  if (value === "strong" || value === "moderate" || value === "weak") return value;
  return "inconclusive";
}

function mapSkepticSeverity(value: string): Challenge["severity"] {
  if (value === "critical" || value === "major" || value === "minor") {
    return value === "major" ? "major" : value;
  }
  return "minor";
}

function impactLabel(impact: string): string {
  return `Impact level: ${impact}`;
}

export function mapEvidenceBundleToReport(
  bundle: InvestigationEvidenceBundle | undefined,
  investigationId: string,
): { evidence: Record<string, Evidence[]>; evidenceGaps: Record<string, EvidenceGap[]> } {
  const evidence: Record<string, Evidence[]> = {};
  const evidenceGaps: Record<string, EvidenceGap[]> = {};

  for (const task of bundle?.tasks ?? []) {
    const claimId = task.claimId;
    evidence[claimId] ??= [];
    evidenceGaps[claimId] ??= [];

    for (const candidate of task.candidates) {
      const excerpt = candidate.excerpts[0];
      evidence[claimId].push({
        id: `${task.taskKey}:${candidate.candidateKey}`,
        claimId,
        investigationId,
        type: mapEvidenceType(candidate.evidenceType),
        strength: mapStrength(candidate.strength),
        observation: candidate.observation,
        repositoryPath: excerpt?.path,
        commitSha: candidate.commitSha,
        lineStart: excerpt?.lineStart,
        lineEnd: excerpt?.lineEnd,
        codeExcerpt: excerpt?.excerptText,
        relevance: `Collected during task ${task.taskKey.replaceAll("_", " ")}.`,
        validation: "accepted",
        discoveredBy: SPECIALIST_TO_AGENT[task.specialistCapability] ?? "repository_investigator",
      });
    }

    for (const gap of task.gaps) {
      evidenceGaps[claimId].push({
        id: `${task.taskKey}:${gap.id}`,
        claimId,
        description: gap.description,
        source: `Task ${task.taskKey}`,
        unavailableReason: "Evidence could not be established from the admitted snapshot.",
        impactOnVerdict: impactLabel(gap.impact),
      });
    }

    for (const counter of task.counterevidence) {
      evidenceGaps[claimId].push({
        id: `${task.taskKey}:${counter.id}`,
        claimId,
        description: counter.description,
        source: `Counterevidence · task ${task.taskKey}`,
        unavailableReason: counter.relatedCandidateId
          ? `Related to candidate ${counter.relatedCandidateId}`
          : "Counterevidence identified during investigation.",
        impactOnVerdict: impactLabel(counter.severity),
      });
    }
  }

  return { evidence, evidenceGaps };
}

export function mapSkepticArtifactToChallenges(
  artifact: SkepticArtifact | null | undefined,
): Record<string, Challenge[]> {
  if (!artifact) return {};

  const challenges: Record<string, Challenge[]> = {};
  for (const challenge of artifact.challenges) {
    challenges[challenge.claimId] ??= [];
    challenges[challenge.claimId].push({
      id: challenge.id,
      claimId: challenge.claimId,
      challengingAgent: "skeptic_agent",
      challengeText: challenge.summary,
      severity: mapSkepticSeverity(challenge.severity),
      resolution: challenge.reasoning,
      verdictChanged: challenge.requestedReinvestigation,
    });
  }
  return challenges;
}

export function mapPlanArtifactToObligations(
  artifact: InvestigationPlanArtifact | null | undefined,
): Record<string, ProofObligation[]> {
  if (!artifact) return {};

  const proofObligations: Record<string, ProofObligation[]> = {};
  for (const claimPlan of artifact.claimPlans) {
    proofObligations[claimPlan.claimId] = claimPlan.obligations.map((obligation) => ({
      id: obligation.id,
      claimId: claimPlan.claimId,
      description: obligation.description,
      status: "unknown",
    }));
  }
  return proofObligations;
}

export function mapArtifactLimitationsToGaps(
  limitations: ReadonlyArray<{ id: string; claimId: string; description: string; impact: string }>,
): Record<string, EvidenceGap[]> {
  const evidenceGaps: Record<string, EvidenceGap[]> = {};
  for (const limitation of limitations) {
    evidenceGaps[limitation.claimId] ??= [];
    evidenceGaps[limitation.claimId].push({
      id: limitation.id,
      claimId: limitation.claimId,
      description: limitation.description,
      source: "Final judgment",
      unavailableReason: "Known limitation recorded in the investigation report.",
      impactOnVerdict: impactLabel(limitation.impact),
    });
  }
  return evidenceGaps;
}

export function mergeEvidenceGaps(
  ...sources: Array<Record<string, EvidenceGap[]>>
): Record<string, EvidenceGap[]> {
  const merged: Record<string, EvidenceGap[]> = {};
  for (const source of sources) {
    for (const [claimId, gaps] of Object.entries(source)) {
      merged[claimId] ??= [];
      merged[claimId].push(...gaps);
    }
  }
  return merged;
}

export type ReportEnrichmentInput = Pick<
  InvestigationReportResponse,
  "evidenceBundle" | "skepticAnalysis" | "investigationPlan"
>;

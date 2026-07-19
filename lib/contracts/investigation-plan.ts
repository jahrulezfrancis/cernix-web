import { z } from "zod";
import { InvestigationIdSchema } from "./investigation-api";

export const PLAN_SCHEMA_VERSION = 1 as const;

export const PLAN_OBLIGATION_ID_MIN = 1;
export const PLAN_OBLIGATION_ID_MAX = 64;
export const PLAN_TASK_ID_MIN = 1;
export const PLAN_TASK_ID_MAX = 64;
export const PLAN_DESCRIPTION_MIN = 1;
export const PLAN_DESCRIPTION_MAX = 2000;
export const PLAN_NOTES_MAX = 4000;
export const PLAN_LIMITATION_MAX = 1000;
export const PLAN_QUERY_TERM_MAX = 200;
export const PLAN_OBLIGATIONS_MAX = 20;
export const PLAN_TASKS_MAX = 30;
export const PLAN_CLAIM_PLANS_MAX = 5;
export const PLAN_LIMITATIONS_MAX = 20;
export const PLAN_QUERY_TERMS_MAX = 20;
export const PLAN_EVIDENCE_TYPES_MAX = 10;
export const PLAN_DEPENDENCIES_MAX = 10;
export const PLAN_OBLIGATION_REFS_MAX = 10;

const bounded = (min: number, max: number) => z.string().trim().min(min).max(max);
const machineId = (min: number, max: number) =>
  bounded(min, max).regex(/^[a-z][a-z0-9_]{0,63}$/);

export const ObligationTaxonomySchema = z.enum([
  "implementation_existence",
  "behavioral",
  "security_control",
  "reliability_operational",
  "testing_quality",
  "architecture_integration",
  "reproducibility_provenance",
  "dependency_supply_chain",
  "documentation_governance",
  "performance_scalability",
]);
export type ObligationTaxonomy = z.infer<typeof ObligationTaxonomySchema>;

export const SpecialistCapabilitySchema = z.enum([
  "repository_investigator",
  "security",
  "testing",
  "database_lifecycle",
  "dependencies",
  "architecture_documentation",
  "reliability",
]);
export type SpecialistCapability = z.infer<typeof SpecialistCapabilitySchema>;

export const EvidenceTypeSchema = z.enum([
  "code_implementation",
  "test_implementation",
  "configuration",
  "migration_schema",
  "ci_workflow",
  "documentation",
  "package_metadata",
  "repository_structure",
  "absence_gap",
  "cross_file_consistency",
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const VerificationObligationSchema = z.strictObject({
  id: machineId(PLAN_OBLIGATION_ID_MIN, PLAN_OBLIGATION_ID_MAX),
  claimId: z.uuid(),
  description: bounded(PLAN_DESCRIPTION_MIN, PLAN_DESCRIPTION_MAX),
  taxonomy: ObligationTaxonomySchema.optional(),
  priority: z.number().int().min(1).max(PLAN_OBLIGATIONS_MAX),
});
export type VerificationObligation = z.infer<typeof VerificationObligationSchema>;

export const EvidenceTaskSchema = z.strictObject({
  id: machineId(PLAN_TASK_ID_MIN, PLAN_TASK_ID_MAX),
  obligationIds: z.array(machineId(PLAN_OBLIGATION_ID_MIN, PLAN_OBLIGATION_ID_MAX))
    .min(1).max(PLAN_OBLIGATION_REFS_MAX),
  specialistCapability: SpecialistCapabilitySchema,
  expectedEvidenceTypes: z.array(EvidenceTypeSchema).min(1).max(PLAN_EVIDENCE_TYPES_MAX),
  queryTerms: z.array(bounded(1, PLAN_QUERY_TERM_MAX)).max(PLAN_QUERY_TERMS_MAX).default([]),
  priority: z.number().int().min(1).max(PLAN_TASKS_MAX),
  dependsOnTaskIds: z.array(machineId(PLAN_TASK_ID_MIN, PLAN_TASK_ID_MAX)).max(PLAN_DEPENDENCIES_MAX).default([]),
});
export type EvidenceTask = z.infer<typeof EvidenceTaskSchema>;

export const InvestigationClaimPlanSchema = z.strictObject({
  claimId: z.uuid(),
  obligations: z.array(VerificationObligationSchema).min(1).max(PLAN_OBLIGATIONS_MAX),
  evidenceTasks: z.array(EvidenceTaskSchema).min(1).max(PLAN_TASKS_MAX),
  knownLimitations: z.array(bounded(1, PLAN_LIMITATION_MAX)).max(PLAN_LIMITATIONS_MAX).default([]),
  plannerNotes: bounded(1, PLAN_NOTES_MAX).optional(),
});
export type InvestigationClaimPlan = z.infer<typeof InvestigationClaimPlanSchema>;

function hasTaskDependencyCycle(tasks: ReadonlyArray<{ id: string; dependsOnTaskIds: string[] }>): boolean {
  const graph = new Map<string, string[]>();
  for (const task of tasks) graph.set(task.id, [...task.dependsOnTaskIds]);
  const visiting = new Set<string>(), visited = new Set<string>();
  function dfs(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const dependencyId of graph.get(node) ?? []) {
      if (dfs(dependencyId)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  for (const taskId of graph.keys()) {
    if (dfs(taskId)) return true;
  }
  return false;
}

export const InvestigationPlanArtifactSchema = z.strictObject({
  schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
  investigationId: InvestigationIdSchema,
  snapshotManifestHash: z.string().regex(/^[0-9a-f]{64}$/),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  claimPlans: z.array(InvestigationClaimPlanSchema).min(1).max(PLAN_CLAIM_PLANS_MAX),
}).superRefine((artifact, context) => {
  const claimIds = new Set<string>();
  for (const claimPlan of artifact.claimPlans) {
    if (claimIds.has(claimPlan.claimId)) {
      context.addIssue({ code: "custom", message: "Duplicate claim plan." });
      return;
    }
    claimIds.add(claimPlan.claimId);
    const obligationIds = new Set(claimPlan.obligations.map((o) => o.id));
    if (obligationIds.size !== claimPlan.obligations.length) {
      context.addIssue({ code: "custom", message: "Duplicate obligation identifiers." });
      return;
    }
    for (const obligation of claimPlan.obligations) {
      if (obligation.claimId !== claimPlan.claimId) {
        context.addIssue({ code: "custom", message: "Obligation claim mismatch." });
        return;
      }
    }
    const taskIds = new Set(claimPlan.evidenceTasks.map((t) => t.id));
    if (taskIds.size !== claimPlan.evidenceTasks.length) {
      context.addIssue({ code: "custom", message: "Duplicate task identifiers." });
      return;
    }
    for (const task of claimPlan.evidenceTasks) {
      for (const obligationId of task.obligationIds) {
        if (!obligationIds.has(obligationId)) {
          context.addIssue({ code: "custom", message: "Task references unknown obligation." });
          return;
        }
      }
      for (const dependencyId of task.dependsOnTaskIds) {
        if (!taskIds.has(dependencyId) || dependencyId === task.id) {
          context.addIssue({ code: "custom", message: "Invalid task dependency." });
          return;
        }
      }
    }
    if (hasTaskDependencyCycle(claimPlan.evidenceTasks)) {
      context.addIssue({ code: "custom", message: "Task dependency cycle detected." });
      return;
    }
  }
});
export type InvestigationPlanArtifact = z.infer<typeof InvestigationPlanArtifactSchema>;

export function validateInvestigationPlanArtifact(raw: unknown): InvestigationPlanArtifact {
  return InvestigationPlanArtifactSchema.parse(raw);
}

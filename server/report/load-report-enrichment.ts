import type { Kysely } from "kysely";
import type { Database } from "@/server/db/types";
import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import { loadPersistedPlan } from "@/server/persistence/investigation-plan-repository";
import { loadPersistedSkepticAnalysis } from "@/server/persistence/skeptic-repository";
import { loadInvestigationEvidenceBundle } from "./investigation-evidence-bundle";

export type ReportEnrichment = Readonly<{
  evidenceBundle: Awaited<ReturnType<typeof loadInvestigationEvidenceBundle>>;
  skepticAnalysis: Awaited<ReturnType<typeof loadPersistedSkepticAnalysis>>;
  investigationPlan: Awaited<ReturnType<typeof loadPersistedPlan>>;
}>;

export async function loadReportEnrichment(
  db: Kysely<Database>,
  rawInvestigationId: unknown,
): Promise<ReportEnrichment> {
  const investigationId = InvestigationIdSchema.parse(rawInvestigationId);
  const [evidenceBundle, skepticAnalysis, investigationPlan] = await Promise.all([
    loadInvestigationEvidenceBundle(db, investigationId),
    loadPersistedSkepticAnalysis(db, investigationId),
    loadPersistedPlan(db, investigationId),
  ]);

  return { evidenceBundle, skepticAnalysis, investigationPlan };
}

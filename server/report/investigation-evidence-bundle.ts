import type { InvestigationEvidenceBundle } from "@/lib/contracts/report-enrichment";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "@/server/db/types";

type Db = Kysely<Database> | Transaction<Database>;

export async function loadInvestigationEvidenceBundle(
  db: Db,
  investigationId: string,
): Promise<InvestigationEvidenceBundle> {
  const runs = await db
    .selectFrom("evidence_task_runs")
    .selectAll()
    .where("investigation_id", "=", investigationId)
    .execute();

  const tasks = [];
  for (const run of runs) {
    const candidates = await db
      .selectFrom("evidence_candidates")
      .selectAll()
      .where("run_id", "=", run.id)
      .execute();

    const candidateSummaries = [];
    for (const candidate of candidates) {
      const excerpts = await db
        .selectFrom("evidence_excerpts")
        .select(["path", "line_start", "line_end", "excerpt_text"])
        .where("candidate_id", "=", candidate.id)
        .execute();

      candidateSummaries.push({
        candidateKey: candidate.candidate_key,
        evidenceType: candidate.evidence_type,
        strength: candidate.strength,
        observation: candidate.observation,
        commitSha: candidate.commit_sha,
        excerpts: excerpts.map((excerpt) => ({
          path: excerpt.path,
          lineStart: excerpt.line_start,
          lineEnd: excerpt.line_end,
          excerptText: excerpt.excerpt_text,
        })),
      });
    }

    const gaps = await db
      .selectFrom("evidence_gaps")
      .select(["gap_key", "description", "impact"])
      .where("run_id", "=", run.id)
      .execute();

    const counters = await db
      .selectFrom("counterevidence_items")
      .select(["counter_key", "description", "severity", "related_candidate_key"])
      .where("run_id", "=", run.id)
      .execute();

    tasks.push({
      taskKey: run.task_key,
      status: run.status,
      specialistCapability: run.specialist_capability,
      claimId: run.claim_id,
      candidates: candidateSummaries,
      gaps: gaps.map((gap) => ({
        id: gap.gap_key,
        description: gap.description,
        impact: gap.impact,
      })),
      counterevidence: counters.map((item) => ({
        id: item.counter_key,
        description: item.description,
        severity: item.severity,
        relatedCandidateId: item.related_candidate_key,
      })),
    });
  }

  return { tasks };
}

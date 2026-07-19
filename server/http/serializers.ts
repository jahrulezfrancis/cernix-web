import {
  InvestigationEventsResponseSchema,
  InvestigationListResponseSchema,
  InvestigationReportResponseSchema,
  InvestigationResponseSchema,
  StartInvestigationResponseSchema,
  type InvestigationEventResponse,
  type InvestigationSummary,
} from "@/lib/contracts/investigation-api";
import { JudgeArtifactSchema } from "@/lib/contracts/judgment-report";
import type { InvestigationReadModel } from "@/server/persistence/investigation-repository";
import type { PersistedInvestigationReport } from "@/server/persistence/judgment-repository";
import type { ReportEnrichment } from "@/server/report/load-report-enrichment";

function toIso(value: Date): string {
  return value.toISOString();
}

export function serializeStartInvestigation(model: InvestigationReadModel, eventCursor: string | number) {
  return StartInvestigationResponseSchema.parse({
    investigationId: model.id,
    status: model.status,
    eventCursor: Number(eventCursor),
  });
}

export function serializeInvestigation(model: InvestigationReadModel) {
  return InvestigationResponseSchema.parse({
    id: model.id,
    status: model.status,
    repository: {
      owner: model.repositoryOwner,
      name: model.repositoryName,
      canonicalUrl: model.repositoryCanonicalUrl,
      requestedRef: model.requestedRef,
    },
    version: model.version,
    createdAt: toIso(model.createdAt),
    updatedAt: toIso(model.updatedAt),
    startedAt: model.startedAt ? toIso(model.startedAt) : null,
    completedAt: model.completedAt ? toIso(model.completedAt) : null,
    failureCode: model.failureCode,
    claim: {
      id: model.claim.id,
      statement: model.claim.statement,
      preservedQualifiers: model.claim.preservedQualifiers,
      approvedAt: model.claim.approvedAt ? toIso(model.claim.approvedAt) : null,
    },
  });
}

export function serializeInvestigationSummary(
  model: InvestigationReadModel,
  hasReport: boolean,
): InvestigationSummary {
  return {
    id: model.id,
    status: model.status,
    repository: {
      owner: model.repositoryOwner,
      name: model.repositoryName,
      canonicalUrl: model.repositoryCanonicalUrl,
      requestedRef: model.requestedRef,
    },
    claimStatement: model.claim.statement,
    createdAt: toIso(model.createdAt),
    updatedAt: toIso(model.updatedAt),
    startedAt: model.startedAt ? toIso(model.startedAt) : null,
    completedAt: model.completedAt ? toIso(model.completedAt) : null,
    hasReport,
  };
}

export function serializeInvestigationList(
  investigations: ReadonlyArray<{ model: InvestigationReadModel; hasReport: boolean }>,
) {
  return InvestigationListResponseSchema.parse({
    investigations: investigations.map(({ model, hasReport }) => serializeInvestigationSummary(model, hasReport)),
  });
}

export function serializeInvestigationEvents(events: ReadonlyArray<{
  sequence: string | number;
  type: string;
  stage: InvestigationEventResponse["stage"];
  publicPayload: unknown;
  createdAt: Date;
}>, nextCursor: string | number) {
  return InvestigationEventsResponseSchema.parse({
    events: events.map((event) => ({
      sequence: Number(event.sequence),
      type: event.type,
      stage: event.stage,
      publicPayload: typeof event.publicPayload === "string" ? JSON.parse(event.publicPayload) : event.publicPayload,
      createdAt: toIso(event.createdAt),
    })),
    nextCursor: Number(nextCursor),
  });
}

export function serializeInvestigationReport(
  report: PersistedInvestigationReport,
  enrichment?: ReportEnrichment,
) {
  return InvestigationReportResponseSchema.parse({
    investigationId: report.investigationId,
    completionDisposition: report.completionDisposition,
    artifactHashSha256: report.artifactHashSha256,
    snapshotManifestHash: report.artifact.snapshotManifestHash,
    artifact: JudgeArtifactSchema.parse(report.artifact),
    evidenceBundle: enrichment?.evidenceBundle,
    skepticAnalysis: enrichment?.skepticAnalysis?.artifact ?? null,
    investigationPlan: enrichment?.investigationPlan?.artifact ?? null,
  });
}

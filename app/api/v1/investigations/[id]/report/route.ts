import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import { ApplicationError } from "@/server/errors";
import { handleRoute } from "@/server/http/route";
import { getDatabase } from "@/server/db/database";
import { investigationRepository, judgmentRepository } from "@/server/http/repositories";
import { serializeInvestigationReport } from "@/server/http/serializers";
import { loadReportEnrichment } from "@/server/report/load-report-enrichment";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { id } = await context.params;
    InvestigationIdSchema.parse(id);
    await investigationRepository().getInvestigation(id);
    const report = await judgmentRepository().findByInvestigation(id);
    if (!report) throw new ApplicationError("not_found", {});
    const enrichment = await loadReportEnrichment(getDatabase(), id);
    return serializeInvestigationReport(report, enrichment);
  });
}

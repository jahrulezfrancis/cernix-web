import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import { handleRoute } from "@/server/http/route";
import { investigationRepository } from "@/server/http/repositories";
import { serializeInvestigation } from "@/server/http/serializers";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { id } = await context.params;
    InvestigationIdSchema.parse(id);
    return serializeInvestigation(await investigationRepository().getInvestigation(id));
  });
}

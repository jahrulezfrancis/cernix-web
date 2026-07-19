import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import { handleAuthenticatedRoute } from "@/server/http/route";
import { investigationRepository } from "@/server/http/repositories";
import { serializeInvestigation } from "@/server/http/serializers";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handleAuthenticatedRoute(request, async (session) => {
    const { id } = await context.params;
    InvestigationIdSchema.parse(id);
    return serializeInvestigation(await investigationRepository().getInvestigation(id, session.id));
  });
}

import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import { handleAuthenticatedRoute } from "@/server/http/route";
import { investigationRepository } from "@/server/http/repositories";
import { serializeInvestigationEvents } from "@/server/http/serializers";
import { boundEventLimit } from "@/server/persistence/helpers";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handleAuthenticatedRoute(request, async (session) => {
    const { id } = await context.params;
    InvestigationIdSchema.parse(id);
    const url = new URL(request.url);
    const after = url.searchParams.get("after") ?? undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw === null ? 50 : Math.min(boundEventLimit(Number(limitRaw)), 50);
    const result = await investigationRepository().getEvents(id, session.id, after, limit);
    return serializeInvestigationEvents(result.events, result.nextCursor);
  });
}

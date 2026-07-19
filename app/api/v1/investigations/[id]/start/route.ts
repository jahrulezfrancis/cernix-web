import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import { handleAuthenticatedRoute, parseIdempotencyKey } from "@/server/http/route";
import { investigationRepository } from "@/server/http/repositories";
import { serializeStartInvestigation } from "@/server/http/serializers";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  return handleAuthenticatedRoute(request, async (session) => {
    const { id } = await context.params;
    InvestigationIdSchema.parse(id);
    const key = parseIdempotencyKey(request);
    const repository = investigationRepository();
    const model = await repository.startInvestigation(id, key, session.id);
    const { nextCursor } = await repository.getEvents(id, session.id);
    return serializeStartInvestigation(model, nextCursor);
  });
}

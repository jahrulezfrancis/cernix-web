import { InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import { handleRoute, parseIdempotencyKey } from "@/server/http/route";
import { investigationRepository } from "@/server/http/repositories";
import { serializeStartInvestigation } from "@/server/http/serializers";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  return handleRoute(async () => {
    const { id } = await context.params;
    InvestigationIdSchema.parse(id);
    const key = parseIdempotencyKey(request);
    const repository = investigationRepository();
    const model = await repository.startInvestigation(id, key);
    const { nextCursor } = await repository.getEvents(id);
    return serializeStartInvestigation(model, nextCursor);
  });
}

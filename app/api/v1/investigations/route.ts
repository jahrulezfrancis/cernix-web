import { CreateInvestigationRequestSchema } from "@/lib/contracts/investigation-api";
import { handleAuthenticatedRoute, parseIdempotencyKey, parseJsonBody } from "@/server/http/route";
import { investigationRepository } from "@/server/http/repositories";
import { serializeInvestigation, serializeInvestigationList } from "@/server/http/serializers";

export async function GET(request: Request) {
  return handleAuthenticatedRoute(request, async (session) =>
    serializeInvestigationList(await investigationRepository().listInvestigations(session.id)));
}

export async function POST(request: Request) {
  return handleAuthenticatedRoute(request, async (session) => {
    const body = await parseJsonBody(request);
    const key = parseIdempotencyKey(request);
    CreateInvestigationRequestSchema.parse(body);
    return serializeInvestigation(await investigationRepository().createInvestigation(body, key, session.id));
  });
}

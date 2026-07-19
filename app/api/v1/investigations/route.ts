import { CreateInvestigationRequestSchema } from "@/lib/contracts/investigation-api";
import { handleRoute, parseIdempotencyKey, parseJsonBody } from "@/server/http/route";
import { investigationRepository } from "@/server/http/repositories";
import { serializeInvestigation, serializeInvestigationList } from "@/server/http/serializers";

export async function GET() {
  return handleRoute(async () => serializeInvestigationList(await investigationRepository().listInvestigations()));
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const body = await parseJsonBody(request);
    const key = parseIdempotencyKey(request);
    CreateInvestigationRequestSchema.parse(body);
    return serializeInvestigation(await investigationRepository().createInvestigation(body, key));
  });
}

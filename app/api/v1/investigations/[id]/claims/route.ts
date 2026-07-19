import { ClaimApprovalRequestSchema, InvestigationIdSchema } from "@/lib/contracts/investigation-api";
import { handleAuthenticatedRoute, parseJsonBody } from "@/server/http/route";
import { investigationRepository } from "@/server/http/repositories";
import { serializeInvestigation } from "@/server/http/serializers";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return handleAuthenticatedRoute(request, async (session) => {
    const { id } = await context.params;
    InvestigationIdSchema.parse(id);
    const body = await parseJsonBody(request);
    ClaimApprovalRequestSchema.parse(body);
    return serializeInvestigation(await investigationRepository().approveClaim(id, body, session.id));
  });
}

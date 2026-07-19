import { SessionResponseSchema, UnauthenticatedSessionResponseSchema } from "@/lib/contracts/auth-api";
import { resolveSession } from "@/server/http/auth";
import { handleRoute } from "@/server/http/route";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const session = await resolveSession(request);
    if (!session) return UnauthenticatedSessionResponseSchema.parse({ authenticated: false });
    return SessionResponseSchema.parse({
      authenticated: true,
      user: {
        id: session.id,
        login: session.login,
        displayName: session.displayName,
        avatarUrl: session.avatarUrl,
      },
    });
  });
}

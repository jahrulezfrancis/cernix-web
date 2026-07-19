import { SessionResponseSchema, UnauthenticatedSessionResponseSchema } from "@/lib/contracts/auth-api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return response.json() as Promise<T>;
}

export async function getSession() {
  const body = await request<unknown>("/api/auth/session");
  const authenticated = SessionResponseSchema.safeParse(body);
  if (authenticated.success) return authenticated.data;
  return UnauthenticatedSessionResponseSchema.parse(body);
}

export async function logout() {
  await request("/api/auth/logout", { method: "POST" });
}

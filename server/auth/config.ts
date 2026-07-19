import { ApplicationError } from "@/server/errors";

export type AuthConfig = Readonly<{
  secret: string;
  appUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  sessionMaxAgeSeconds: number;
}>;

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

let override: AuthConfig | undefined;

function requireNonEmpty(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new ApplicationError("internal_error", { cause: new Error(`Missing ${field}`) });
  return trimmed;
}

export function parseAuthConfig(environment: Readonly<Record<string, string | undefined>>): AuthConfig {
  const secret = requireNonEmpty(environment.AUTH_SECRET, "AUTH_SECRET");
  if (secret.length < 32) {
    throw new ApplicationError("internal_error", { cause: new Error("AUTH_SECRET must be at least 32 characters") });
  }
  const appUrl = requireNonEmpty(environment.AUTH_URL, "AUTH_URL").replace(/\/$/, "");
  try {
    new URL(appUrl);
  } catch (error) {
    throw new ApplicationError("internal_error", { cause: error });
  }
  return Object.freeze({
    secret,
    appUrl,
    githubClientId: requireNonEmpty(environment.AUTH_GITHUB_CLIENT_ID, "AUTH_GITHUB_CLIENT_ID"),
    githubClientSecret: requireNonEmpty(environment.AUTH_GITHUB_CLIENT_SECRET, "AUTH_GITHUB_CLIENT_SECRET"),
    sessionMaxAgeSeconds: SESSION_MAX_AGE_SECONDS,
  });
}

export function getAuthConfig(): AuthConfig {
  return override ?? parseAuthConfig(process.env);
}

export function setAuthConfigForTests(config: AuthConfig | undefined): void {
  override = config;
}

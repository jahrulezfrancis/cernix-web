import { describe, expect, it } from "vitest";
import { parseAuthConfig } from "./config";

describe("parseAuthConfig", () => {
  it("parses required auth environment variables", () => {
    const config = parseAuthConfig({
      AUTH_SECRET: "test-secret-with-at-least-32-characters",
      AUTH_URL: "http://localhost:3000/",
      AUTH_GITHUB_CLIENT_ID: "client-id",
      AUTH_GITHUB_CLIENT_SECRET: "client-secret",
    });
    expect(config.appUrl).toBe("http://localhost:3000");
    expect(config.githubClientId).toBe("client-id");
    expect(config.sessionMaxAgeSeconds).toBeGreaterThan(0);
  });

  it("rejects short secrets", () => {
    expect(() => parseAuthConfig({
      AUTH_SECRET: "short",
      AUTH_URL: "http://localhost:3000",
      AUTH_GITHUB_CLIENT_ID: "client-id",
      AUTH_GITHUB_CLIENT_SECRET: "client-secret",
    })).toThrow();
  });
});

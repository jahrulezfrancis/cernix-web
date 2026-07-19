import { describe, expect, it, vi } from "vitest";
import type { GitHubSnapshotConfig } from "./config";
import { GitHubClient } from "./client";
import type { TimeSource } from "./request-budget";

function config(overrides: Partial<GitHubSnapshotConfig> = {}): GitHubSnapshotConfig {
  return { token: null, apiVersion: "2026-03-10", requestTimeoutMs: 100, snapshotDeadlineMs: 10_000,
    maxRequests: 50, maxInspectedEntries: 100, maxAdmittedFiles: 20, maxFileBytes: 1_024,
    maxTotalTextBytes: 10_000, maxLinesPerFile: 100, maxTreeDepth: 10, maxConcurrency: 2, ...overrides };
}
function json(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json", ...init.headers }, ...init });
}
function fakeTime() {
  let now = 1_000;
  const sleeps: number[] = [];
  const time: TimeSource = { now: () => now, random: () => 0, sleep: async (ms) => { sleeps.push(ms); now += ms; } };
  return { time, sleeps, advance: (ms: number) => { now += ms; } };
}

describe("GitHub client boundary", () => {
  it("constructs only constant-origin URLs, encodes refs once, and pins exact headers", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init }); return json({ ok: true }); });
    const client = new GitHubClient(config({ token: "sentinel-token" }), fetcher);
    await client.getCommit("Acme", "Widget", "feature/a b");
    expect(calls[0].url).toBe("https://api.github.com/repos/Acme/Widget/commits/feature%2Fa%20b");
    expect(calls[0].init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(calls[0].init?.headers).toEqual({ Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "Cernix-Repository-Snapshot/1",
      Authorization: "Bearer sentinel-token" });
    expect(() => client.getRepository("evil/path", "repo")).toThrow();
  });

  it("omits authorization anonymously and rejects redirects without following them", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).not.toHaveProperty("Authorization");
      return new Response(null, { status: 302, headers: { location: "https://evil.example/token" } });
    });
    await expect(new GitHubClient(config(), fetcher).getRepository("Acme", "Widget"))
      .rejects.toMatchObject({ failureCode: "github_redirect_rejected" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("retries only retryable responses with bounded deterministic backoff", async () => {
    const clock = fakeTime();
    const fetcher = vi.fn().mockResolvedValueOnce(json({ message: "busy" }, { status: 503 }))
      .mockResolvedValueOnce(json({ message: "secondary rate limit" }, { status: 403, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(json({ ok: true }, { headers: { "x-ratelimit-remaining": "42", "x-ratelimit-reset": "999", "x-github-request-id": "safe-id" } }));
    const client = new GitHubClient(config(), fetcher, clock.time);
    await expect(client.getRepository("Acme", "Widget")).resolves.toEqual({ ok: true });
    expect(clock.sleeps).toEqual([250, 1_000]);
    expect(client.budget.requestCount).toBe(3);
    expect(client.rateMetadata).toMatchObject({ remaining: "42", reset: "999", requestId: "safe-id" });
  });

  it.each([[400, "malformed_github_response"], [401, "github_authentication_failed"], [404, "repository_not_found"], [422, "malformed_github_response"]])
  ("does not retry HTTP %i", async (status, failureCode) => {
    const fetcher = vi.fn(async () => json({ message: "safe" }, { status }));
    await expect(new GitHubClient(config(), fetcher).getRepository("Acme", "Widget")).rejects.toMatchObject({ failureCode });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("enforces cumulative request and overall deadline budgets", async () => {
    const clock = fakeTime();
    const client = new GitHubClient(config({ maxRequests: 2 }), vi.fn(async () => json({}, { status: 500 })), clock.time);
    await expect(client.getRepository("Acme", "Widget")).rejects.toMatchObject({ failureCode: "request_budget_exceeded" });
    clock.advance(20_000);
    expect(() => client.budget.claim()).toThrow(expect.objectContaining({ failureCode: "snapshot_deadline_exceeded" }));
  });

  it("bounds response bodies and never serializes a token in safe errors", async () => {
    const client = new GitHubClient(config({ token: "never-leak-this", maxFileBytes: 1 }), vi.fn(async () =>
      new Response("x".repeat(100_000), { status: 200 })));
    const error = await client.getBlob("Acme", "Widget", "a".repeat(40)).catch((value) => value);
    expect(error).toMatchObject({ failureCode: "malformed_github_response" });
    expect(JSON.stringify(error)).not.toContain("never-leak-this");
  });

  it("propagates caller cancellation", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const pending = new GitHubClient(config(), fetcher).getRepository("Acme", "Widget", controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toMatchObject({ failureCode: "github_unavailable" });
  });

  it("maps an empty-repository commit conflict without retrying", async () => {
    const fetcher = vi.fn(async () => json({ message: "Git Repository is empty." }, { status: 409 }));
    await expect(new GitHubClient(config(), fetcher).getCommit("Acme", "Widget", "main"))
      .rejects.toMatchObject({ failureCode: "ref_not_found" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("retries bounded request timeouts without resetting the request count", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }));
      const client = new GitHubClient(config({ requestTimeoutMs: 10, snapshotDeadlineMs: 10_000 }), fetcher);
      const assertion = expect(client.getRepository("Acme", "Widget")).rejects.toMatchObject({ failureCode: "github_unavailable" });
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(client.budget.requestCount).toBe(3);
    } finally { vi.useRealTimers(); }
  });
});

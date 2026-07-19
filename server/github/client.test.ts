import { describe, expect, it, vi } from "vitest";
import type { GitHubSnapshotConfig } from "./config";
import { GitHubClient } from "./client";
import { SnapshotRequestBudget, systemTimeSource, type TimeSource } from "./request-budget";

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

  it("keeps valid refs inside one route component and rejects dot-only refs", async () => {
    const paths: string[] = [];
    const client = new GitHubClient(config(), vi.fn(async (input) => { paths.push(new URL(String(input)).pathname); return json({}); }));
    for (const ref of ["feature/example", "refs/heads/feature/example", "percent%value", "question?value", "fragment#value", "user@value"]) {
      await client.getCommit("Acme", "Widget", ref);
    }
    expect(paths).toEqual([
      "/repos/Acme/Widget/commits/feature%2Fexample", "/repos/Acme/Widget/commits/refs%2Fheads%2Ffeature%2Fexample",
      "/repos/Acme/Widget/commits/percent%25value", "/repos/Acme/Widget/commits/question%3Fvalue",
      "/repos/Acme/Widget/commits/fragment%23value", "/repos/Acme/Widget/commits/user%40value",
    ]);
    expect(() => client.getCommit("Acme", "Widget", ".")).toThrow();
    expect(() => client.getCommit("Acme", "Widget", "..")).toThrow();
  });

  it.each([
    ["1", "1"], [String(Number.MAX_SAFE_INTEGER), String(Number.MAX_SAFE_INTEGER)],
    ["9007199254740992", "9007199254740992"], ["9223372036854775807", "9223372036854775807"],
  ])("preserves an unquoted repository id %s losslessly", async (lexeme, expected) => {
    const raw = ` { "owner":{"id":999}, "name":"Widget", "id" : ${lexeme} } `;
    await expect(new GitHubClient(config(), vi.fn(async () => new Response(raw))).getRepository("Acme", "Widget"))
      .resolves.toMatchObject({ id: expected });
  });

  it.each(["0", "-1", "1.5", "1e3", "9223372036854775808", '"1"'])
  ("rejects a noncanonical repository id %s", async (id) => {
    await expect(new GitHubClient(config(), vi.fn(async () => new Response(`{"id":${id}}`))).getRepository("Acme", "Widget"))
      .rejects.toMatchObject({ failureCode: "malformed_github_response" });
  });

  it("rejects duplicate top-level repository ids without confusing nested ids", async () => {
    const duplicate = new GitHubClient(config(), vi.fn(async () => new Response('{"owner":{"id":2},"id":1,"id":2}')));
    await expect(duplicate.getRepository("Acme", "Widget")).rejects.toMatchObject({ failureCode: "malformed_github_response" });
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

  it.each([
    [undefined], ["1"],
  ])("bounds a streamed body with absent or dishonest content-length", async (declared) => {
    const headers = declared ? { "content-length": declared } : undefined;
    const client = new GitHubClient(config({ maxFileBytes: 1 }), vi.fn(async () => new Response("x".repeat(100_000), { headers })));
    await expect(client.getBlob("Acme", "Widget", "a".repeat(40))).rejects.toMatchObject({ failureCode: "malformed_github_response" });
  });

  it("makes zero requests for a pre-aborted signal", async () => {
    const controller = new AbortController(); controller.abort(new Error("private cancellation detail"));
    const fetcher = vi.fn(async () => json({}));
    await expect(new GitHubClient(config(), fetcher).getRepository("Acme", "Widget", controller.signal))
      .rejects.toMatchObject({ failureCode: "github_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
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

  it("aborts during retry sleep and starts no later request", async () => {
    const controller = new AbortController();
    let sleeping!: () => void;
    const beganSleep = new Promise<void>((resolve) => { sleeping = resolve; });
    const time: TimeSource = { now: () => 1_000, random: () => 0, sleep: (_ms, signal) => new Promise((_resolve, reject) => {
      sleeping();
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    }) };
    const fetcher = vi.fn(async () => json({ message: "busy" }, { status: 503 }));
    const pending = new GitHubClient(config(), fetcher, time).getRepository("Acme", "Widget", controller.signal);
    await beganSleep; controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toMatchObject({ failureCode: "github_unavailable" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("caps retry sleep to the remaining overall deadline", async () => {
    const clock = fakeTime();
    const fetcher = vi.fn().mockResolvedValueOnce(json({ message: "busy" }, { status: 503 })).mockResolvedValueOnce(json({ ok: true }));
    await expect(new GitHubClient(config({ snapshotDeadlineMs: 200 }), fetcher, clock.time).getRepository("Acme", "Widget"))
      .resolves.toEqual({ ok: true });
    expect(clock.sleeps).toEqual([199]);
  });

  it("distinguishes ordinary forbidden responses from verified rate limits", async () => {
    await expect(new GitHubClient(config(), vi.fn(async () => json({ message: "forbidden" }, { status: 403 }))).getRepository("Acme", "Widget"))
      .rejects.toMatchObject({ failureCode: "malformed_github_response" });
    await expect(new GitHubClient(config(), vi.fn(async () => json({ message: "forbidden" }, { status: 403, headers: { "x-ratelimit-remaining": "0" } }))).getRepository("Acme", "Widget"))
      .rejects.toMatchObject({ failureCode: "github_rate_limited" });
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

describe("snapshot request budget and time source", () => {
  it("enforces zero, one, exact maximum, and one-over boundaries synchronously", () => {
    const clock = fakeTime();
    expect(() => new SnapshotRequestBudget(0, 1_000, clock.time).claim()).toThrow(expect.objectContaining({ failureCode: "request_budget_exceeded" }));
    const one = new SnapshotRequestBudget(1, 1_000, clock.time);
    expect(one.claim()).toBe(1);
    expect(() => one.claim()).toThrow(expect.objectContaining({ failureCode: "request_budget_exceeded" }));
    const exact = new SnapshotRequestBudget(3, 1_000, clock.time);
    expect([exact.claim(), exact.claim(), exact.claim()]).toEqual([1, 2, 3]);
    expect(exact.requestCount).toBe(3);
  });

  it("does not claim a request for an already-cancelled caller", () => {
    const controller = new AbortController(); controller.abort();
    const budget = new SnapshotRequestBudget(1, 1_000, fakeTime().time);
    expect(() => budget.claim(controller.signal)).toThrow(expect.objectContaining({ failureCode: "github_unavailable" }));
    expect(budget.requestCount).toBe(0);
  });

  it("removes the sleep abort listener after resolution and rejection", async () => {
    vi.useFakeTimers();
    try {
      const resolved = new AbortController();
      const removeResolved = vi.spyOn(resolved.signal, "removeEventListener");
      const sleep = systemTimeSource.sleep(5, resolved.signal);
      await vi.advanceTimersByTimeAsync(5); await sleep;
      expect(removeResolved).toHaveBeenCalledWith("abort", expect.any(Function));

      const rejected = new AbortController();
      const removeRejected = vi.spyOn(rejected.signal, "removeEventListener");
      const abortedSleep = systemTimeSource.sleep(5, rejected.signal);
      rejected.abort();
      await expect(abortedSleep).rejects.toBeDefined();
      expect(removeRejected).toHaveBeenCalledWith("abort", expect.any(Function));
    } finally { vi.useRealTimers(); }
  });
});

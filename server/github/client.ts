import { GITHUB_API_ORIGIN, type GitHubRateMetadata } from "./contracts";
import type { GitHubSnapshotConfig } from "./config";
import { SnapshotError } from "./errors";
import { SnapshotRequestBudget, systemTimeSource, type TimeSource } from "./request-budget";

export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
const TRANSIENT_NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);
const SHA = /^[0-9a-fA-F]{40}$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;

function component(value: string, kind: "owner" | "repository" | "ref" | "sha"): string {
  const valid = kind === "owner" ? OWNER.test(value) : kind === "repository" ? REPOSITORY.test(value)
    : kind === "sha" ? SHA.test(value) : value.length >= 1 && value.length <= 255 && !/[\u0000-\u001f\u007f]/.test(value);
  if (!valid) throw new SnapshotError("malformed_github_response");
  return encodeURIComponent(value);
}

function metadata(headers: Headers): GitHubRateMetadata {
  const bounded = (name: string, maximum: number) => {
    const value = headers.get(name);
    return value && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
  };
  return Object.freeze({
    remaining: bounded("x-ratelimit-remaining", 32), reset: bounded("x-ratelimit-reset", 32),
    retryAfter: bounded("retry-after", 32), requestId: bounded("x-github-request-id", 128),
  });
}

async function boundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximum) throw new SnapshotError("malformed_github_response");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > maximum) { await reader.cancel(); throw new SnapshotError("malformed_github_response"); }
    chunks.push(result.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch (cause) { throw new SnapshotError("malformed_github_response", cause); }
}

function transient(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (error instanceof SnapshotError) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  const cause = "cause" in error && error.cause && typeof error.cause === "object" ? error.cause : undefined;
  const causeCode = cause && "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
  return (code !== undefined && TRANSIENT_NETWORK_CODES.has(code)) || (causeCode !== undefined && TRANSIENT_NETWORK_CODES.has(causeCode));
}

function secondaryLimit(status: number, value: unknown): boolean {
  if (status !== 403 || !value || typeof value !== "object" || !("message" in value) || typeof value.message !== "string") return false;
  return /secondary rate limit|abuse detection/i.test(value.message);
}

export class GitHubClient {
  readonly budget: SnapshotRequestBudget;
  rateMetadata: GitHubRateMetadata = Object.freeze({ remaining: null, reset: null, retryAfter: null, requestId: null });
  constructor(
    private readonly config: GitHubSnapshotConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly time: TimeSource = systemTimeSource,
  ) { this.budget = new SnapshotRequestBudget(config.maxRequests, config.snapshotDeadlineMs, time); }

  getRepository(owner: string, repository: string, signal?: AbortSignal) {
    return this.request(`/repos/${component(owner, "owner")}/${component(repository, "repository")}`, 1_048_576, signal, "repository");
  }
  getCommit(owner: string, repository: string, ref: string, signal?: AbortSignal) {
    return this.request(`/repos/${component(owner, "owner")}/${component(repository, "repository")}/commits/${component(ref, "ref")}`, 1_048_576, signal, "commit");
  }
  getTree(owner: string, repository: string, sha: string, recursive: boolean, signal?: AbortSignal) {
    const suffix = recursive ? "?recursive=1" : "";
    return this.request(`/repos/${component(owner, "owner")}/${component(repository, "repository")}/git/trees/${component(sha, "sha")}${suffix}`, 8_000_000, signal, "tree");
  }
  getBlob(owner: string, repository: string, sha: string, signal?: AbortSignal) {
    const encodedMaximum = Math.ceil(this.config.maxFileBytes / 3) * 4 + 65_536;
    return this.request(`/repos/${component(owner, "owner")}/${component(repository, "repository")}/git/blobs/${component(sha, "sha")}`, encodedMaximum, signal, "blob");
  }

  private async request(path: string, maximumBody: number, signal: AbortSignal | undefined, missingKind: "repository" | "commit" | "tree" | "blob"): Promise<unknown> {
    const url = `${GITHUB_API_ORIGIN}${path}`;
    if (new URL(url).origin !== GITHUB_API_ORIGIN) throw new SnapshotError("malformed_github_response");
    for (let attempt = 0; attempt < 3; attempt++) {
      this.budget.claim();
      const timeout = Math.min(this.config.requestTimeoutMs, this.budget.remainingTime());
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const response = await this.fetchImplementation(url, {
          method: "GET", redirect: "manual", signal: controller.signal,
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": this.config.apiVersion,
            "User-Agent": "Cernix-Repository-Snapshot/1",
            ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
          },
        });
        this.rateMetadata = metadata(response.headers);
        if (response.status >= 300 && response.status < 400) throw new SnapshotError("github_redirect_rejected");
        const body = await boundedBody(response, maximumBody);
        const value = body.byteLength ? parseJson(body) : null;
        const retryable = response.status === 429 || response.status >= 500 || secondaryLimit(response.status, value);
        if (retryable && attempt < 2) {
          await this.backoff(attempt, this.rateMetadata.retryAfter, signal);
          continue;
        }
        if (response.ok) return value;
        if (response.status === 401) throw new SnapshotError("github_authentication_failed");
        if (response.status === 403 && (secondaryLimit(response.status, value) || this.rateMetadata.remaining === "0")) throw new SnapshotError("github_rate_limited");
        if (response.status === 429) throw new SnapshotError("github_rate_limited");
        if (response.status === 409 && missingKind === "commit") throw new SnapshotError("ref_not_found");
        if (response.status === 404) throw new SnapshotError(missingKind === "repository" ? "repository_not_found" : missingKind === "commit" ? "ref_not_found" : "malformed_github_response");
        if (response.status >= 500) throw new SnapshotError("github_unavailable");
        throw new SnapshotError("malformed_github_response");
      } catch (error) {
        if (signal?.aborted) throw new SnapshotError("github_unavailable");
        if (error instanceof SnapshotError) throw error;
        if ((!timedOut && !transient(error)) || attempt >= 2) throw new SnapshotError("github_unavailable");
        await this.backoff(attempt, null, signal);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }
    throw new SnapshotError("github_unavailable");
  }

  private async backoff(attempt: number, retryAfter: string | null, signal?: AbortSignal): Promise<void> {
    const headerMs = retryAfter && /^\d{1,4}$/.test(retryAfter) ? Number(retryAfter) * 1_000 : 0;
    const jittered = 250 * 2 ** attempt + Math.floor(this.time.random() * 100);
    const delay = Math.min(Math.max(headerMs, jittered), 5_000, this.budget.remainingTime() - 1);
    if (delay <= 0) throw new SnapshotError("snapshot_deadline_exceeded");
    await this.time.sleep(delay, signal);
    this.budget.assertTime();
  }
}

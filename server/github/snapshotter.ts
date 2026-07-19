import { createHash } from "node:crypto";
import type { GitHubSnapshotConfig } from "./config";
import { ADMISSION_POLICY_VERSION, type RepositoryIdentity, type SnapshotArtifact, type SnapshotEntry } from "./contracts";
import { SnapshotError } from "./errors";
import { applyAdmissionPolicy, compareUtf8, isUnambiguouslyNormalizedPath, MAX_SNAPSHOT_PATH_BYTES, type InspectedTreeEntry } from "./file-policy";
import { finalizeArtifact } from "./manifest";
import { secretPolicyEvaluator } from "./secret-scan";
import { gitBlobSha1 } from "./git-object";
import type { GitHubClient } from "./client";

const SHA = /^[0-9a-fA-F]{40}$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SnapshotError("malformed_github_response");
  return value as Record<string, unknown>;
}
function string(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new SnapshotError("malformed_github_response");
  return value;
}
function sha(value: unknown): string {
  const result = string(value, 40);
  if (!SHA.test(result)) throw new SnapshotError("malformed_github_response");
  return result.toLowerCase();
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new SnapshotError("malformed_github_response");
  return value;
}
function decimal(value: unknown, nullable = false): string | null {
  if (nullable && value === undefined) return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^(?:0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n) return value;
  throw new SnapshotError("malformed_github_response");
}

function repositoryMetadata(value: unknown): RepositoryIdentity & { defaultBranch: string } {
  const source = record(value), ownerValue = record(source.owner);
  const id = decimal(source.id)!;
  if (BigInt(id) <= 0n) throw new SnapshotError("malformed_github_response");
  if (boolean(source.private)) throw new SnapshotError("repository_private");
  if (boolean(source.archived)) throw new SnapshotError("repository_archived");
  if (boolean(source.disabled)) throw new SnapshotError("repository_disabled");
  const reportedKilobytes = decimal(source.size)!;
  if (BigInt(reportedKilobytes) > 102_400n) throw new SnapshotError("repository_too_large");
  const canonicalOwner = string(ownerValue.login, 39), canonicalRepository = string(source.name, 100);
  if (!OWNER.test(canonicalOwner) || !REPOSITORY.test(canonicalRepository)) throw new SnapshotError("malformed_github_response");
  const defaultBranch = string(source.default_branch, 255);
  return {
    githubRepositoryId: id, canonicalOwner, canonicalRepository,
    canonicalUrl: `https://github.com/${canonicalOwner}/${canonicalRepository}`, defaultBranch,
  };
}

function commitIdentity(value: unknown): { commitSha: string; rootTreeSha: string } {
  const source = record(value), commit = record(source.commit), tree = record(commit.tree);
  return { commitSha: sha(source.sha), rootTreeSha: sha(tree.sha) };
}

function treeResponse(value: unknown, expectedSha: string, allowTruncated: boolean): { truncated: boolean; entries: InspectedTreeEntry[] } {
  const source = record(value);
  if (sha(source.sha) !== expectedSha) throw new SnapshotError("malformed_github_response");
  const truncated = boolean(source.truncated);
  if (truncated && !allowTruncated) throw new SnapshotError("malformed_github_response");
  if (!Array.isArray(source.tree)) throw new SnapshotError("malformed_github_response");
  const entries = source.tree.map((raw): InspectedTreeEntry => {
    const entry = record(raw), path = string(entry.path, 4_096);
    if (Buffer.byteLength(path, "utf8") > MAX_SNAPSHOT_PATH_BYTES) throw new SnapshotError("malformed_github_response");
    if (/\p{Surrogate}/u.test(path)) throw new SnapshotError("malformed_github_response");
    const mode = string(entry.mode, 6), type = string(entry.type, 16);
    if (!(["100644", "100755", "040000", "120000", "160000"].includes(mode)) || !(["blob", "tree", "commit"].includes(type))) {
      throw new SnapshotError("malformed_github_response");
    }
    return {
      path, mode, type, sha: sha(entry.sha),
      reportedSize: decimal(entry.size, true),
    };
  });
  return { truncated, entries };
}

function ensureUniquePaths(entries: readonly InspectedTreeEntry[]): void {
  const paths = new Set<string>();
  for (const entry of entries) {
    const normalized = entry.path.normalize("NFC");
    if (paths.has(normalized)) throw new SnapshotError("duplicate_tree_path");
    paths.add(normalized);
  }
}

function entryTreeDepth(entry: Pick<InspectedTreeEntry, "path" | "mode" | "type">): number {
  const slashCount = entry.path.split("/").length - 1;
  return entry.mode === "040000" && entry.type === "tree" ? slashCount + 1 : slashCount;
}

function enforceTreeDepth(entries: readonly InspectedTreeEntry[], maximum: number): void {
  if (entries.some((entry) => entryTreeDepth(entry) > maximum)) throw new SnapshotError("tree_depth_exceeded");
}

async function enumerateTree(client: GitHubClient, owner: string, repository: string, rootSha: string, config: GitHubSnapshotConfig, signal?: AbortSignal): Promise<InspectedTreeEntry[]> {
  const recursive = treeResponse(await client.getTree(owner, repository, rootSha, true, signal), rootSha, true);
  if (!recursive.truncated) {
    if (recursive.entries.length > config.maxInspectedEntries) throw new SnapshotError("tree_entry_limit_exceeded");
    enforceTreeDepth(recursive.entries, config.maxTreeDepth);
    ensureUniquePaths(recursive.entries);
    return recursive.entries.sort((a, b) => compareUtf8(a.path, b.path));
  }
  type Work = { prefix: string; treeSha: string; depth: number; ancestors: ReadonlySet<string> };
  const queue: Work[] = [{ prefix: "", treeSha: rootSha, depth: 0, ancestors: new Set([rootSha]) }];
  const visited = new Set<string>();
  const trees = new Map<string, readonly InspectedTreeEntry[]>();
  const result: InspectedTreeEntry[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const work = queue[cursor];
    const key = `${work.prefix}\u0000${work.treeSha}`;
    if (visited.has(key)) throw new SnapshotError("tree_cycle_detected");
    visited.add(key);
    let relatives = trees.get(work.treeSha);
    if (!relatives) {
      const response = treeResponse(await client.getTree(owner, repository, work.treeSha, false, signal), work.treeSha, false);
      relatives = [...response.entries].sort((a, b) => compareUtf8(a.path, b.path));
      trees.set(work.treeSha, relatives);
    }
    const children: Work[] = [];
    for (const relative of relatives) {
      if (relative.path.includes("/")) throw new SnapshotError("malformed_github_response");
      const full = work.prefix ? `${work.prefix}/${relative.path}` : relative.path;
      const entry = { ...relative, path: full };
      if (entryTreeDepth(entry) > config.maxTreeDepth) throw new SnapshotError("tree_depth_exceeded");
      result.push(entry);
      if (result.length > config.maxInspectedEntries) throw new SnapshotError("tree_entry_limit_exceeded");
      if (relative.mode === "040000" && relative.type === "tree") {
        const depth = work.depth + 1;
        if (depth > config.maxTreeDepth) throw new SnapshotError("tree_depth_exceeded");
        if (work.ancestors.has(relative.sha)) throw new SnapshotError("tree_cycle_detected");
        children.push({ prefix: full, treeSha: relative.sha, depth, ancestors: new Set([...work.ancestors, relative.sha]) });
      }
    }
    queue.push(...children);
  }
  ensureUniquePaths(result);
  return result.sort((a, b) => compareUtf8(a.path, b.path));
}

function strictBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) return null;
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.toString("base64") !== normalized) return null;
  return decoded;
}

function excluded(entry: SnapshotEntry, reason: NonNullable<SnapshotEntry["exclusionReason"]>): SnapshotEntry {
  return { ...entry, decision: "excluded", exclusionReason: reason, rawSha256: null, normalizedSha256: null, byteCount: null, lineCount: null,
    rawContent: undefined, normalizedText: undefined, detectedLanguage: undefined };
}

function language(path: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return ({ ts: "TypeScript", tsx: "TSX", js: "JavaScript", jsx: "JSX", py: "Python", rs: "Rust", go: "Go", java: "Java", rb: "Ruby", php: "PHP", css: "CSS", scss: "SCSS", html: "HTML", md: "Markdown", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", sh: "Shell", sql: "SQL" } as Record<string, string>)[ext] ?? null;
}

function verifyBlob(entry: SnapshotEntry, value: unknown, config: GitHubSnapshotConfig): SnapshotEntry {
  let source: Record<string, unknown>, responseSha: string, responseSize: string;
  try {
    source = record(value);
    responseSha = sha(source.sha);
    responseSize = decimal(source.size)!;
  } catch (cause) { throw new SnapshotError("blob_verification_failed", cause); }
  if (responseSha !== entry.objectSha || source.encoding !== "base64") throw new SnapshotError("blob_verification_failed");
  const raw = strictBase64(source.content);
  if (!raw || BigInt(responseSize) !== BigInt(raw.byteLength) ||
      (entry.reportedSize !== null && BigInt(entry.reportedSize) !== BigInt(raw.byteLength))) {
    throw new SnapshotError("blob_verification_failed");
  }
  const gitHash = gitBlobSha1(raw);
  if (gitHash !== entry.objectSha) throw new SnapshotError("blob_verification_failed");
  if (raw.byteLength > config.maxFileBytes) return excluded(entry, "file_too_large");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
  catch { return excluded(entry, "invalid_utf8"); }
  if (TEXT_CONTROL.test(text)) return excluded(entry, "binary_content");
  if (secretPolicyEvaluator(ADMISSION_POLICY_VERSION)(text)) return excluded(entry, "secret_detected");
  const normalizedText = text.replace(/\r\n?/g, "\n");
  const lineCount = normalizedText.length === 0 ? 0 : (normalizedText.match(/\n/g)?.length ?? 0) + (normalizedText.endsWith("\n") ? 0 : 1);
  if (lineCount > config.maxLinesPerFile) return excluded(entry, "line_count_limit");
  const normalized = new TextEncoder().encode(normalizedText);
  return {
    ...entry, rawContent: raw, normalizedText, detectedLanguage: language(entry.path),
    rawSha256: createHash("sha256").update(raw).digest("hex"),
    normalizedSha256: createHash("sha256").update(normalized).digest("hex"),
    byteCount: raw.byteLength, lineCount,
  };
}

type SnapshotterTestHooks = Readonly<{ retainedBytes?(bytes: number): void }>;

async function retrieveBlobs(entries: SnapshotEntry[], client: GitHubClient, owner: string, repository: string, config: GitHubSnapshotConfig, signal?: AbortSignal, hooks?: SnapshotterTestHooks): Promise<SnapshotEntry[]> {
  const output = [...entries], indexes = entries.map((entry, index) => entry.decision === "admitted" ? index : -1).filter((index) => index >= 0);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", cancel, { once: true });
  type Settled = { entry?: SnapshotEntry; error?: unknown; retained: number };
  const pending = new Map<number, Promise<Settled>>();
  let nextToSchedule = 0, admittedBytes = 0, pendingBytes = 0, fatal = false, fatalError: unknown;
  const report = () => hooks?.retainedBytes?.(admittedBytes + pendingBytes);
  const start = (position: number) => {
    const index = indexes[position], original = output[index];
    const task = client.getBlob(owner, repository, original.objectSha, controller.signal)
      .then((value): Settled => {
        const entry = verifyBlob(original, value, config);
        const retained = entry.decision === "admitted" ? entry.byteCount! : 0;
        pendingBytes += retained; report();
        return { entry, retained };
      })
      .catch((error): Settled => {
        fatal = true;
        if (error instanceof SnapshotError && error.failureCode === "blob_verification_failed") fatalError = error;
        else fatalError ??= error;
        controller.abort();
        return { error, retained: 0 };
      });
    pending.set(position, task);
  };
  const fill = () => {
    while (!fatal && nextToSchedule < indexes.length && pending.size < config.maxConcurrency) start(nextToSchedule++);
  };
  fill();
  try {
    for (let position = 0; position < indexes.length; position++) {
      const result = await pending.get(position)!;
      pending.delete(position);
      pendingBytes -= result.retained;
      if (result.error) {
        controller.abort();
        await Promise.all(pending.values());
        throw fatalError ?? result.error;
      }
      const index = indexes[position], verified = result.entry!;
      if (verified.decision === "admitted" && admittedBytes + verified.byteCount! > config.maxTotalTextBytes) {
        output[index] = excluded(verified, "total_bytes_limit");
      } else {
        output[index] = verified;
        if (verified.decision === "admitted") admittedBytes += verified.byteCount!;
      }
      report();
      fill();
    }
    return output;
  } finally {
    controller.abort();
    await Promise.all(pending.values());
    signal?.removeEventListener("abort", cancel);
  }
}

export async function buildRepositorySnapshot(input: {
  owner: string; repository: string; requestedRef: string | null; client: GitHubClient;
  config: GitHubSnapshotConfig; signal?: AbortSignal; testHooks?: SnapshotterTestHooks;
}): Promise<SnapshotArtifact> {
  const metadata = repositoryMetadata(await input.client.getRepository(input.owner, input.repository, input.signal));
  const resolvedRef = input.requestedRef ?? metadata.defaultBranch;
  const commit = commitIdentity(await input.client.getCommit(metadata.canonicalOwner, metadata.canonicalRepository, resolvedRef, input.signal));
  const inspected = await enumerateTree(input.client, metadata.canonicalOwner, metadata.canonicalRepository, commit.rootTreeSha, input.config, input.signal);
  for (const entry of inspected) {
    if (!isUnambiguouslyNormalizedPath(entry.path) && Buffer.byteLength(entry.path, "utf8") > MAX_SNAPSHOT_PATH_BYTES) throw new SnapshotError("malformed_github_response");
  }
  const entries = await retrieveBlobs(applyAdmissionPolicy(inspected, input.config), input.client, metadata.canonicalOwner, metadata.canonicalRepository, input.config, input.signal, input.testHooks);
  return finalizeArtifact({ ...metadata, requestedRef: input.requestedRef, resolvedRef, ...commit, entries });
}

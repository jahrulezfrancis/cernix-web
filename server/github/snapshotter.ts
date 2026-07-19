import { createHash } from "node:crypto";
import type { GitHubSnapshotConfig } from "./config";
import type { RepositoryIdentity, SnapshotArtifact, SnapshotEntry } from "./contracts";
import { SnapshotError } from "./errors";
import { applyAdmissionPolicy, compareUtf8, isUnambiguouslyNormalizedPath, MAX_SNAPSHOT_PATH_BYTES, type InspectedTreeEntry } from "./file-policy";
import { finalizeArtifact } from "./manifest";
import { containsHighConfidenceSecret } from "./secret-scan";
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

async function enumerateTree(client: GitHubClient, owner: string, repository: string, rootSha: string, config: GitHubSnapshotConfig, signal?: AbortSignal): Promise<InspectedTreeEntry[]> {
  const recursive = treeResponse(await client.getTree(owner, repository, rootSha, true, signal), rootSha, true);
  if (!recursive.truncated) {
    if (recursive.entries.length > config.maxInspectedEntries) throw new SnapshotError("tree_entry_limit_exceeded");
    ensureUniquePaths(recursive.entries);
    return recursive.entries.sort((a, b) => compareUtf8(a.path, b.path));
  }
  type Work = { prefix: string; treeSha: string; depth: number; ancestors: ReadonlySet<string> };
  const queue: Work[] = [{ prefix: "", treeSha: rootSha, depth: 0, ancestors: new Set([rootSha]) }];
  const visited = new Set<string>();
  const result: InspectedTreeEntry[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const work = queue[cursor];
    const key = `${work.prefix}\u0000${work.treeSha}`;
    if (visited.has(key)) throw new SnapshotError("tree_cycle_detected");
    visited.add(key);
    const response = treeResponse(await client.getTree(owner, repository, work.treeSha, false, signal), work.treeSha, false);
    const children: Work[] = [];
    for (const relative of response.entries.sort((a, b) => compareUtf8(a.path, b.path))) {
      if (relative.path.includes("/")) throw new SnapshotError("malformed_github_response");
      const full = work.prefix ? `${work.prefix}/${relative.path}` : relative.path;
      const entry = { ...relative, path: full };
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
  if (typeof value !== "string" || /[^A-Za-z0-9+/=\r\n]/.test(value)) return null;
  const compact = value.replace(/\r?\n/g, "");
  if (compact.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) return null;
  const decoded = Buffer.from(compact, "base64");
  if (decoded.toString("base64") !== compact) return null;
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
  const source = record(value);
  let responseSha: string;
  try { responseSha = sha(source.sha); } catch { return excluded(entry, "blob_mismatch"); }
  if (responseSha !== entry.objectSha) return excluded(entry, "blob_mismatch");
  if (source.encoding !== "base64") return excluded(entry, "unsupported_encoding");
  const raw = strictBase64(source.content);
  if (!raw) return excluded(entry, "unsupported_encoding");
  const responseSize = decimal(source.size, true);
  if (responseSize !== null && BigInt(responseSize) !== BigInt(raw.byteLength)) return excluded(entry, "content_size_mismatch");
  if (entry.reportedSize !== null && BigInt(entry.reportedSize) !== BigInt(raw.byteLength)) return excluded(entry, "content_size_mismatch");
  if (raw.byteLength > config.maxFileBytes) return excluded(entry, "file_too_large");
  const gitHash = createHash("sha1").update(`blob ${raw.byteLength}\0`).update(raw).digest("hex");
  if (gitHash !== entry.objectSha) return excluded(entry, "blob_mismatch");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
  catch { return excluded(entry, "invalid_utf8"); }
  if (TEXT_CONTROL.test(text)) return excluded(entry, "binary_content");
  if (containsHighConfidenceSecret(text)) return excluded(entry, "secret_detected");
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

async function retrieveBlobs(entries: SnapshotEntry[], client: GitHubClient, owner: string, repository: string, config: GitHubSnapshotConfig, signal?: AbortSignal): Promise<SnapshotEntry[]> {
  const output = [...entries], indexes = entries.map((entry, index) => entry.decision === "admitted" ? index : -1).filter((index) => index >= 0);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", cancel, { once: true });
  let cursor = 0;
  const workers = Array.from({ length: Math.min(config.maxConcurrency, indexes.length) }, async () => {
    try {
      while (cursor < indexes.length) {
        const index = indexes[cursor++];
        const entry = output[index];
        const value = await client.getBlob(owner, repository, entry.objectSha, controller.signal);
        output[index] = verifyBlob(entry, value, config);
      }
    } catch (error) {
      controller.abort();
      throw error;
    }
  });
  try { await Promise.all(workers); }
  finally { signal?.removeEventListener("abort", cancel); }
  let total = 0n;
  for (let index = 0; index < output.length; index++) {
    const entry = output[index];
    if (entry.decision !== "admitted") continue;
    const next = total + BigInt(entry.byteCount!);
    if (next > BigInt(config.maxTotalTextBytes)) output[index] = excluded(entry, "total_bytes_limit");
    else total = next;
  }
  return output;
}

export async function buildRepositorySnapshot(input: {
  owner: string; repository: string; requestedRef: string | null; client: GitHubClient;
  config: GitHubSnapshotConfig; signal?: AbortSignal;
}): Promise<SnapshotArtifact> {
  const metadata = repositoryMetadata(await input.client.getRepository(input.owner, input.repository, input.signal));
  const resolvedRef = input.requestedRef ?? metadata.defaultBranch;
  const commit = commitIdentity(await input.client.getCommit(metadata.canonicalOwner, metadata.canonicalRepository, resolvedRef, input.signal));
  const inspected = await enumerateTree(input.client, metadata.canonicalOwner, metadata.canonicalRepository, commit.rootTreeSha, input.config, input.signal);
  for (const entry of inspected) {
    if (!isUnambiguouslyNormalizedPath(entry.path) && Buffer.byteLength(entry.path, "utf8") > MAX_SNAPSHOT_PATH_BYTES) throw new SnapshotError("malformed_github_response");
  }
  const entries = await retrieveBlobs(applyAdmissionPolicy(inspected, input.config), input.client, metadata.canonicalOwner, metadata.canonicalRepository, input.config, input.signal);
  return finalizeArtifact({ ...metadata, requestedRef: input.requestedRef, resolvedRef, ...commit, entries });
}

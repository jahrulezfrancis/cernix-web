import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GitHubClient } from "./client";
import type { GitHubSnapshotConfig } from "./config";
import { buildRepositorySnapshot } from "./snapshotter";
import { canonicalizeManifest } from "./manifest";
import type { SnapshotEntry } from "./contracts";

const ROOT = "a".repeat(40), SUBTREE = "b".repeat(40), COMMIT = "c".repeat(40);
const config: GitHubSnapshotConfig = { token: null, apiVersion: "2026-03-10", requestTimeoutMs: 1_000,
  snapshotDeadlineMs: 10_000, maxRequests: 50, maxInspectedEntries: 100, maxAdmittedFiles: 20,
  maxFileBytes: 1_024, maxTotalTextBytes: 10_000, maxLinesPerFile: 100, maxTreeDepth: 10, maxConcurrency: 2 };

function blob(content: Uint8Array | string) {
  const raw = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
  const sha = createHash("sha1").update(`blob ${raw.byteLength}\0`).update(raw).digest("hex");
  return { sha, raw, response: { sha, encoding: "base64", size: raw.byteLength, content: raw.toString("base64") } };
}
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function repositoryResponse(id = "9007199254740991") { return new Response(`{"id":${id},"name":"Widget","private":false,"archived":false,"disabled":false,"size":1,"default_branch":"main","owner":{"login":"Acme"}}`); }
function baseRoutes(tree: unknown, blobs: Map<string, unknown> = new Map()) {
  return async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/Acme/Widget") return repositoryResponse();
    if (url.endsWith("/commits/main")) return response({ sha: COMMIT.toUpperCase(), commit: { tree: { sha: ROOT.toUpperCase() } } });
    if (url.endsWith(`/git/trees/${ROOT}?recursive=1`)) return response(tree);
    const blobSha = url.match(/\/git\/blobs\/([0-9a-f]{40})$/)?.[1];
    if (blobSha && blobs.has(blobSha)) return response(blobs.get(blobSha));
    throw new Error(`Unexpected offline fixture request: ${url}`);
  };
}
function treeEntry(path: string, object: ReturnType<typeof blob>, mode = "100644", type = "blob") {
  return { path, mode, type, sha: object.sha, size: object.raw.byteLength };
}

describe("immutable repository snapshotter", () => {
  it("validates identity, filters content, verifies blobs, normalizes text, and builds a deterministic manifest", async () => {
    const readme = blob("Hello\r\nworld\r"), binary = blob(new Uint8Array([0, 1, 2])), secretValue = `ghp_${"A".repeat(36)}`;
    const secret = blob(`const token = "${secretValue}";\n`);
    const entries = [
      treeEntry("secret.ts", secret), { path: "vendor", mode: "040000", type: "tree", sha: SUBTREE },
      treeEntry("README.md", readme), treeEntry("binary.txt", binary),
      { path: "unsafe/../escape.ts", mode: "100644", type: "blob", sha: "d".repeat(40), size: 1 },
      { path: "package-lock.json", mode: "100644", type: "blob", sha: "e".repeat(40), size: 1 },
    ];
    const blobs = new Map([[readme.sha, readme.response], [binary.sha, binary.response], [secret.sha, secret.response]]);
    const fetcher = vi.fn(baseRoutes({ sha: ROOT, truncated: false, tree: entries }, blobs));
    const artifact = await buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(config, fetcher), config });
    expect(artifact).toMatchObject({ githubRepositoryId: "9007199254740991", canonicalOwner: "Acme",
      canonicalRepository: "Widget", canonicalUrl: "https://github.com/Acme/Widget", defaultBranch: "main",
      requestedRef: null, resolvedRef: "main", commitSha: COMMIT, rootTreeSha: ROOT,
      manifestSchemaVersion: 1, admissionPolicyVersion: 1, inspectedEntryCount: 6,
      admittedFileCount: 1, excludedEntryCount: 5, totalAdmittedBytes: String(readme.raw.byteLength) });
    const admitted = artifact.entries.find((entry) => entry.path === "README.md")!;
    expect(admitted).toMatchObject({ decision: "admitted", normalizedText: "Hello\nworld\n", lineCount: 2,
      byteCount: readme.raw.byteLength, detectedLanguage: "Markdown" });
    expect(admitted.rawSha256).toBe(createHash("sha256").update(readme.raw).digest("hex"));
    expect(admitted.normalizedSha256).toBe(createHash("sha256").update("Hello\nworld\n").digest("hex"));
    expect(artifact.entries.find((entry) => entry.path === "binary.txt")?.exclusionReason).toBe("binary_content");
    expect(artifact.entries.find((entry) => entry.path === "secret.ts")?.exclusionReason).toBe("secret_detected");
    expect(artifact.entries.find((entry) => entry.path === "unsafe/../escape.ts")?.exclusionReason).toBe("unsafe_path");
    expect(artifact.entries.find((entry) => entry.path === "package-lock.json")?.exclusionReason).toBe("lockfile");
    expect(JSON.stringify(artifact)).not.toContain(secretValue);
    expect(Buffer.from(artifact.canonicalManifest).at(-1)).toBe(10);
    expect(artifact.manifestHashSha256).toBe(createHash("sha256").update(artifact.canonicalManifest).digest("hex"));
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("discards a truncated recursive tree and uses deterministic bounded BFS without a recursive parameter", async () => {
    const one = blob("one\n"), two = blob("two\n"), blobs = new Map([[one.sha, one.response], [two.sha, two.response]]);
    const fullTree = { sha: ROOT, truncated: false, tree: [
      { path: "src", mode: "040000", type: "tree", sha: SUBTREE }, treeEntry("README.md", one),
      { ...treeEntry("src/index.ts", two) },
    ] };
    const truncatedCalls: string[] = [];
    const truncatedFetcher = async (input: string | URL | Request) => {
      const url = String(input); truncatedCalls.push(url);
      if (url.endsWith(`/git/trees/${ROOT}?recursive=1`)) return response({ sha: ROOT, truncated: true, tree: [{ path: "discarded", mode: "100644", type: "blob", sha: "f".repeat(40) }] });
      if (url.endsWith(`/git/trees/${ROOT}`)) return response({ sha: ROOT, truncated: false, tree: [
        { path: "src", mode: "040000", type: "tree", sha: SUBTREE }, treeEntry("README.md", one),
      ] });
      if (url.endsWith(`/git/trees/${SUBTREE}`)) return response({ sha: SUBTREE, truncated: false, tree: [treeEntry("index.ts", two)] });
      return baseRoutes(fullTree, blobs)(input);
    };
    const fallback = await buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(config, truncatedFetcher), config });
    const direct = await buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(config, baseRoutes(fullTree, blobs)), config });
    expect(fallback.manifestHashSha256).toBe(direct.manifestHashSha256);
    expect(fallback.entries.map((entry) => entry.path)).toEqual(["README.md", "src", "src/index.ts"]);
    expect(truncatedCalls.filter((url) => url.includes("/git/trees/")).slice(1).every((url) => !url.includes("recursive"))).toBe(true);
  });

  it("aborts on Git object identity mismatches", async () => {
    const valid = blob("safe\n");
    const tree = { sha: ROOT, truncated: false, tree: [treeEntry("bad.ts", valid)] };
    const mismatch = { ...valid.response, sha: "d".repeat(40) };
    await expect(buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: "main",
      client: new GitHubClient(config, baseRoutes(tree, new Map([[valid.sha, mismatch]]))), config }))
      .rejects.toMatchObject({ failureCode: "blob_verification_failed" });
  });

  it.each([
    [new Uint8Array([0xff]), {}, "invalid_utf8"],
    [new Uint8Array([0, 65]), {}, "binary_content"],
    [Buffer.from("safe\n"), { encoding: "utf-8" }, "blob_verification_failed"],
    [Buffer.from("safe\n"), { content: "%%%=" }, "blob_verification_failed"],
    [Buffer.from("safe\n"), { size: 99 }, "blob_verification_failed"],
  ])("excludes content that fails byte validation as %s", async (rawValue, mutation, reason) => {
    const object = blob(rawValue as Uint8Array);
    const tree = { sha: ROOT, truncated: false, tree: [treeEntry("candidate.txt", object)] };
    const promise = buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(config, baseRoutes(tree, new Map([[object.sha, { ...object.response, ...mutation }]]))), config });
    if (reason === "invalid_utf8" || reason === "binary_content") {
      expect((await promise).entries[0]).toMatchObject({ decision: "excluded", exclusionReason: reason, rawContent: undefined });
    } else await expect(promise).rejects.toMatchObject({ failureCode: reason });
  });

  it("enforces actual byte and normalized line limits after download", async () => {
    const large = blob("12345"), multiline = blob("a\nb\n"), loose = { ...config, maxFileBytes: 4, maxLinesPerFile: 1 };
    const tree = { sha: ROOT, truncated: false, tree: [
      { ...treeEntry("large.txt", large), size: undefined }, { ...treeEntry("lines.txt", multiline), size: undefined },
    ] };
    const artifact = await buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(loose, baseRoutes(tree, new Map([[large.sha, large.response], [multiline.sha, multiline.response]]))), config: loose });
    expect(artifact.entries.find((entry) => entry.path === "large.txt")?.exclusionReason).toBe("file_too_large");
    expect(artifact.entries.find((entry) => entry.path === "lines.txt")?.exclusionReason).toBe("line_count_limit");
  });

  it.each([
    [{ id: 1, name: "Widget", private: true, archived: false, disabled: false, size: 1, default_branch: "main", owner: { login: "Acme" } }, "repository_private"],
    [{ id: 1, name: "Widget", private: false, archived: true, disabled: false, size: 1, default_branch: "main", owner: { login: "Acme" } }, "repository_archived"],
    [{ id: 1, name: "Widget", private: false, archived: false, disabled: true, size: 1, default_branch: "main", owner: { login: "Acme" } }, "repository_disabled"],
    [{ id: 1, name: "Widget", private: false, archived: false, disabled: false, size: 102_401, default_branch: "main", owner: { login: "Acme" } }, "repository_too_large"],
  ])("rejects unsupported repository metadata", async (metadata, failureCode) => {
    const client = new GitHubClient(config, vi.fn(async () => response(metadata)));
    await expect(buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null, client, config }))
      .rejects.toMatchObject({ failureCode });
  });

  it("enforces entry limits, duplicate normalized paths, depth, and cycles", async () => {
    const limited = { ...config, maxInspectedEntries: 1 };
    const tree = { sha: ROOT, truncated: false, tree: [
      { path: "a", mode: "040000", type: "tree", sha: SUBTREE },
      { path: "b", mode: "040000", type: "tree", sha: "d".repeat(40) },
    ] };
    await expect(buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(limited, baseRoutes(tree)), config: limited })).rejects.toMatchObject({ failureCode: "tree_entry_limit_exceeded" });
    const duplicate = { sha: ROOT, truncated: false, tree: [
      { path: "é.ts", mode: "100644", type: "blob", sha: "d".repeat(40), size: 1 },
      { path: "e\u0301.ts", mode: "100644", type: "blob", sha: "e".repeat(40), size: 1 },
    ] };
    await expect(buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(config, baseRoutes(duplicate)), config })).rejects.toMatchObject({ failureCode: "duplicate_tree_path" });
  });

  it.each([
    [1, { sha: SUBTREE, truncated: false, tree: [{ path: "deep", mode: "040000", type: "tree", sha: "d".repeat(40) }] }, "tree_depth_exceeded"],
    [10, { sha: SUBTREE, truncated: false, tree: [{ path: "cycle", mode: "040000", type: "tree", sha: ROOT }] }, "tree_cycle_detected"],
  ])("rejects truncated fallback depth and ancestor cycles", async (maxTreeDepth, subtreeResponse, failureCode) => {
    const bounded = { ...config, maxTreeDepth };
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/git/trees/${ROOT}?recursive=1`)) return response({ sha: ROOT, truncated: true, tree: [] });
      if (url.endsWith(`/git/trees/${ROOT}`)) return response({ sha: ROOT, truncated: false, tree: [{ path: "src", mode: "040000", type: "tree", sha: SUBTREE }] });
      if (url.endsWith(`/git/trees/${SUBTREE}`)) return response(subtreeResponse);
      return baseRoutes({}, new Map())(input);
    };
    await expect(buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(bounded, fetcher), config: bounded })).rejects.toMatchObject({ failureCode });
  });

  it("admits an empty UTF-8 blob and completes an empty repository without special cases", async () => {
    const empty = blob("");
    const withEmpty = await buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(config, baseRoutes({ sha: ROOT, truncated: false, tree: [treeEntry("empty.txt", empty)] }, new Map([[empty.sha, empty.response]]))), config });
    expect(withEmpty.entries[0]).toMatchObject({ decision: "admitted", byteCount: 0, lineCount: 0, normalizedText: "" });
    const repository = await buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(config, baseRoutes({ sha: ROOT, truncated: false, tree: [] })), config });
    expect(repository).toMatchObject({ inspectedEntryCount: 0, admittedFileCount: 0, excludedEntryCount: 0, totalAdmittedBytes: "0" });
  });

  it("bounds concurrent blob retrieval", async () => {
    const objects = [blob("a"), blob("b"), blob("c"), blob("d")], blobs = new Map(objects.map((object) => [object.sha, object.response]));
    let active = 0, peak = 0;
    const fixture = baseRoutes({ sha: ROOT, truncated: false, tree: objects.map((object, index) => treeEntry(`${index}.txt`, object)) }, blobs);
    const fetcher = async (input: string | URL | Request) => {
      if (String(input).includes("/git/blobs/")) {
        active++; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        try { return await fixture(input); } finally { active--; }
      }
      return fixture(input);
    };
    await buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient({ ...config, maxConcurrency: 2 }, fetcher), config: { ...config, maxConcurrency: 2 } });
    expect(peak).toBe(2);
  });

  it("admits verified bytes greedily in canonical order with a bounded completion window", async () => {
    const objects = [blob("aaaa"), blob("bbbb"), blob("c")];
    const tree = { sha: ROOT, truncated: false, tree: objects.map((object, index) => ({ ...treeEntry(`${index}.txt`, object), size: undefined })) };
    const blobs = new Map(objects.map((object) => [object.sha, object.response]));
    const build = async (maxConcurrency: number) => {
      let peak = 0;
      const fixture = baseRoutes(tree, blobs);
      const fetcher = async (input: string | URL | Request) => {
        const sha = String(input).match(/\/git\/blobs\/([0-9a-f]{40})$/)?.[1];
        if (sha) await new Promise((resolve) => setTimeout(resolve, sha === objects[0].sha ? 8 : 1));
        return fixture(input);
      };
      const bounded = { ...config, maxConcurrency, maxFileBytes: 10, maxTotalTextBytes: 5 };
      const artifact = await buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
        client: new GitHubClient(bounded, fetcher), config: bounded, testHooks: { retainedBytes: (bytes) => { peak = Math.max(peak, bytes); } } });
      expect(peak).toBeLessThanOrEqual(bounded.maxTotalTextBytes + bounded.maxConcurrency * bounded.maxFileBytes);
      return artifact;
    };
    const serial = await build(1), concurrent = await build(3);
    expect(concurrent.entries.map((entry) => entry.exclusionReason)).toEqual([null, "total_bytes_limit", null]);
    expect(concurrent.totalAdmittedBytes).toBe("5");
    expect(concurrent.manifestHashSha256).toBe(serial.manifestHashSha256);
  });

  it.each([
    ["response sha", (object: ReturnType<typeof blob>) => ({ ...object.response, sha: "f".repeat(40) }), undefined],
    ["unsupported encoding", (object: ReturnType<typeof blob>) => ({ ...object.response, encoding: "utf-8" }), undefined],
    ["missing encoding", (object: ReturnType<typeof blob>) => { const { encoding: _encoding, ...rest } = object.response; return rest; }, undefined],
    ["invalid base64 alphabet", (object: ReturnType<typeof blob>) => ({ ...object.response, content: "%%%=" }), undefined],
    ["base64 whitespace", (object: ReturnType<typeof blob>) => ({ ...object.response, content: `${object.response.content}\n` }), undefined],
    ["missing base64 padding", (object: ReturnType<typeof blob>) => ({ ...object.response, content: object.response.content.slice(0, -1) }), undefined],
    ["excess base64 padding", (object: ReturnType<typeof blob>) => ({ ...object.response, content: `${object.response.content}=` }), undefined],
    ["middle base64 padding", (object: ReturnType<typeof blob>) => ({ ...object.response, content: "c2=FmZSE" }), undefined],
    ["noncanonical trailing bits", (object: ReturnType<typeof blob>) => ({ ...object.response, content: "TR==" }), undefined],
    ["response size", (object: ReturnType<typeof blob>) => ({ ...object.response, size: object.raw.byteLength + 1 }), undefined],
    ["tree size", (object: ReturnType<typeof blob>) => object.response, 99],
    ["understated tree size", (object: ReturnType<typeof blob>) => object.response, 1],
    ["recomputed git sha", (object: ReturnType<typeof blob>) => ({ ...object.response, content: Buffer.from("other").toString("base64") }), undefined],
  ])("fails the complete snapshot for a provider integrity anomaly: %s", async (_name, mutate, treeSize) => {
    const object = blob("safe!");
    const entry = { ...treeEntry("candidate.txt", object), ...(treeSize === undefined ? {} : { size: treeSize }) };
    const tree = { sha: ROOT, truncated: false, tree: [entry] };
    await expect(buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(config, baseRoutes(tree, new Map([[object.sha, mutate(object)]]))), config }))
      .rejects.toMatchObject({ failureCode: "blob_verification_failed", code: "dependency_unavailable" });
  });

  it("enforces the same depth boundary on a complete recursive tree", async () => {
    const bounded = { ...config, maxTreeDepth: 1 };
    const direct = { sha: ROOT, truncated: false, tree: [
      { path: "src", mode: "040000", type: "tree", sha: SUBTREE },
      { path: "src/deep/file.ts", mode: "100644", type: "blob", sha: "d".repeat(40), size: 1 },
    ] };
    await expect(buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(bounded, baseRoutes(direct)), config: bounded }))
      .rejects.toMatchObject({ failureCode: "tree_depth_exceeded" });
  });

  it("mounts a repeated subtree at every prefix without treating aliases as cycles", async () => {
    const object = blob("shared\n");
    let subtreeCalls = 0;
    const fetcher = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/git/trees/${ROOT}?recursive=1`)) return response({ sha: ROOT, truncated: true, tree: [] });
      if (url.endsWith(`/git/trees/${ROOT}`)) return response({ sha: ROOT, truncated: false, tree: [
        { path: "a", mode: "040000", type: "tree", sha: SUBTREE },
        { path: "b", mode: "040000", type: "tree", sha: SUBTREE },
      ] });
      if (url.endsWith(`/git/trees/${SUBTREE}`)) { subtreeCalls++; return response({ sha: SUBTREE, truncated: false, tree: [treeEntry("shared.txt", object)] }); }
      return baseRoutes({}, new Map([[object.sha, object.response]]))(input);
    };
    const artifact = await buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
      client: new GitHubClient(config, fetcher), config });
    expect(artifact.entries.map((entry) => entry.path)).toEqual(["a", "a/shared.txt", "b", "b/shared.txt"]);
    expect(subtreeCalls).toBe(1);
  });
});

describe("manifest canonicalization", () => {
  const entry = (path: string, hash: string): SnapshotEntry => ({ path, mode: "100644", type: "blob", objectSha: hash,
    reportedSize: "1", decision: "excluded", exclusionReason: "binary_content", rawSha256: null,
    normalizedSha256: null, byteCount: null, lineCount: null });
  const base = { githubRepositoryId: "1", canonicalOwner: "Acme", canonicalRepository: "Widget",
    canonicalUrl: "https://github.com/Acme/Widget", defaultBranch: "main", requestedRef: null,
    resolvedRef: "main", commitSha: COMMIT, rootTreeSha: ROOT };
  it("is source-order independent and sensitive to meaningful entry changes", () => {
    const a = entry("a", "d".repeat(40)), b = entry("b", "e".repeat(40));
    const first = canonicalizeManifest({ ...base, entries: [b, a] });
    const second = canonicalizeManifest({ ...base, entries: [a, b] });
    const changed = canonicalizeManifest({ ...base, entries: [{ ...a, exclusionReason: "secret_detected" }, b] });
    expect(first.hash).toBe(second.hash);
    expect(first.hash).not.toBe(changed.hash);
  });

  it("changes for every manifest identity and entry decision field", () => {
    const admitted: SnapshotEntry = { path: "a", mode: "100644", type: "blob", objectSha: "d".repeat(40),
      reportedSize: "1", decision: "admitted", exclusionReason: null, rawSha256: "1".repeat(64),
      normalizedSha256: "2".repeat(64), byteCount: 1, lineCount: 1 };
    const original = canonicalizeManifest({ ...base, entries: [admitted] }).hash;
    const variants = [
      { ...base, githubRepositoryId: "2", entries: [admitted] },
      { ...base, canonicalOwner: "Other", entries: [admitted] },
      { ...base, canonicalRepository: "Other", entries: [admitted] },
      { ...base, requestedRef: "tag", entries: [admitted] },
      { ...base, resolvedRef: "other", entries: [admitted] },
      { ...base, commitSha: "e".repeat(40), entries: [admitted] },
      { ...base, rootTreeSha: "e".repeat(40), entries: [admitted] },
      { ...base, entries: [{ ...admitted, path: "b" }] },
      { ...base, entries: [{ ...admitted, mode: "100755" }] },
      { ...base, entries: [{ ...admitted, type: "tree" }] },
      { ...base, entries: [{ ...admitted, objectSha: "e".repeat(40) }] },
      { ...base, entries: [{ ...admitted, reportedSize: "2" }] },
      { ...base, entries: [{ ...admitted, decision: "excluded" as const, exclusionReason: "binary_content" as const }] },
      { ...base, entries: [{ ...admitted, rawSha256: "3".repeat(64) }] },
      { ...base, entries: [{ ...admitted, normalizedSha256: "3".repeat(64) }] },
      { ...base, entries: [{ ...admitted, byteCount: 2 }] },
      { ...base, entries: [{ ...admitted, lineCount: 2 }] },
    ];
    expect(variants.every((variant) => canonicalizeManifest(variant).hash !== original)).toBe(true);
  });
});

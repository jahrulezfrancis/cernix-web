import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql, type Kysely } from "kysely";
import type { Database } from "@/server/db/types";
import { createDisposableTestDatabase } from "@/server/db/test-database";
import { migrateToLatest, rollbackOne } from "@/server/db/migrate";
import { InvestigationRepository } from "./investigation-repository";
import { RepositorySnapshotRepository } from "./repository-snapshot-repository";
import { canonicalizeManifest, finalizeArtifact } from "@/server/github/manifest";
import type { SnapshotEntry } from "@/server/github/contracts";
import { RepositorySnapshotService } from "@/server/github/snapshot-service";
import { GitHubClient } from "@/server/github/client";
import { buildRepositorySnapshot } from "@/server/github/snapshotter";
import type { GitHubSnapshotConfig } from "@/server/github/config";

let harness: Awaited<ReturnType<typeof createDisposableTestDatabase>>;
let db: Kysely<Database>, investigations: InvestigationRepository, snapshots: RepositorySnapshotRepository;
const SECRET_SENTINEL = `ghp_${"S".repeat(36)}`;
const githubConfig: GitHubSnapshotConfig = { token: null, apiVersion: "2026-03-10", requestTimeoutMs: 1_000,
  snapshotDeadlineMs: 10_000, maxRequests: 50, maxInspectedEntries: 100, maxAdmittedFiles: 20,
  maxFileBytes: 1_024, maxTotalTextBytes: 10_000, maxLinesPerFile: 100, maxTreeDepth: 10, maxConcurrency: 2 };

async function truncate() {
  await sql`truncate repository_snapshot_files, repository_snapshot_entries, repository_snapshots, investigation_jobs, idempotency_records, investigation_events, manual_claims, investigations restart identity cascade`.execute(db);
}
async function snapshotting() {
  const created = await investigations.createInvestigation({ repositoryUrl: "https://github.com/Acme/Widget", claim: { statement: "A safe claim." } }, randomUUID());
  await investigations.approveClaim(created.id, { statement: "A safe claim.", preservedQualifiers: [], approved: true });
  return investigations.startInvestigation(created.id, randomUUID());
}
function artifact() {
  const raw = Buffer.from("hello\r\n"), normalized = "hello\n";
  const admitted: SnapshotEntry = { path: "README.md", mode: "100644", type: "blob", objectSha: "ef0493b275aa2080237f676d2ef6559246f56636",
    reportedSize: String(raw.byteLength), decision: "admitted", exclusionReason: null,
    rawSha256: createHash("sha256").update(raw).digest("hex"), normalizedSha256: createHash("sha256").update(normalized).digest("hex"),
    byteCount: raw.byteLength, lineCount: 1, rawContent: raw, normalizedText: normalized, detectedLanguage: "Markdown" };
  const excluded: SnapshotEntry = { path: ".env", mode: "100644", type: "blob", objectSha: "e".repeat(40),
    reportedSize: "99", decision: "excluded", exclusionReason: "secret_path", rawSha256: null,
    normalizedSha256: null, byteCount: null, lineCount: null,
    rawContent: Buffer.from(SECRET_SENTINEL), normalizedText: SECRET_SENTINEL };
  return finalizeArtifact({ githubRepositoryId: "9007199254740991", canonicalOwner: "Acme", canonicalRepository: "Widget",
    canonicalUrl: "https://github.com/Acme/Widget", defaultBranch: "main", requestedRef: null, resolvedRef: "main",
    commitSha: "a".repeat(40), rootTreeSha: "b".repeat(40), entries: [excluded, admitted] });
}
async function tableCount(table: "repository_snapshots" | "repository_snapshot_entries" | "repository_snapshot_files") {
  return Number((await db.selectFrom(table).select(db.fn.countAll().as("count")).executeTakeFirstOrThrow()).count);
}

beforeAll(async () => {
  harness = await createDisposableTestDatabase(); db = harness.db;
  investigations = new InvestigationRepository(db); snapshots = new RepositorySnapshotRepository(db);
  await migrateToLatest(db);
});
beforeEach(truncate);
afterAll(async () => { await harness?.cleanup(); });

describe.sequential("immutable repository snapshot persistence", () => {
  it("installs exact snapshot tables, relationships, indexes, and reversible migration 002", async () => {
    const tables = await sql<{ table_name: string }>`select table_name from information_schema.tables where table_schema='public' and table_name like 'repository_snapshot%' order by table_name`.execute(db);
    expect(tables.rows.map((row) => row.table_name)).toEqual(["repository_snapshot_entries", "repository_snapshot_files", "repository_snapshots"]);
    const columns = await sql<{ table_name: string; count: string }>`select table_name,count(*)::text count from information_schema.columns where table_schema='public' and table_name like 'repository_snapshot%' group by table_name order by table_name`.execute(db);
    expect(columns.rows).toEqual([
      { table_name: "repository_snapshot_entries", count: "10" },
      { table_name: "repository_snapshot_files", count: "12" },
      { table_name: "repository_snapshots", count: "19" },
    ]);
    const indexes = await sql<{ indexname: string }>`select indexname from pg_indexes where schemaname='public' and indexname in ('repository_snapshots_identity_idx','repository_snapshot_files_snapshot_idx') order by indexname`.execute(db);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(["repository_snapshot_files_snapshot_idx", "repository_snapshots_identity_idx"]);
    const investigation = await snapshotting();
    await snapshots.createForInvestigation(investigation.id, artifact());
    const legacyBefore = Number((await db.selectFrom("investigation_events").select(db.fn.countAll().as("count"))
      .where("type", "!=", "repository_snapshot_persisted").executeTakeFirstOrThrow()).count);
    await rollbackOne(db);
    expect((await sql`select to_regclass('public.repository_snapshots') name`.execute(db)).rows[0]).toMatchObject({ name: null });
    expect(Number((await db.selectFrom("investigation_events").select(db.fn.countAll().as("count"))
      .where("type", "!=", "repository_snapshot_persisted").executeTakeFirstOrThrow()).count)).toBe(legacyBefore);
    expect(await db.selectFrom("investigation_events").select("sequence").where("type", "=", "repository_snapshot_persisted").execute()).toHaveLength(0);
    await migrateToLatest(db);
  });

  it("atomically persists one snapshot, all entries, admitted bodies, and one safe event with precision-safe BIGINTs", async () => {
    const investigation = await snapshotting(), built = artifact();
    const persisted = await snapshots.createForInvestigation(investigation.id, built);
    expect(persisted).toMatchObject({ githubRepositoryId: "9007199254740991", totalAdmittedBytes: built.totalAdmittedBytes,
      manifestHashSha256: built.manifestHashSha256, inspectedEntryCount: 2, admittedFileCount: 1, excludedEntryCount: 1 });
    expect(persisted.entries).toHaveLength(2);
    expect(persisted.entries.find((entry) => entry.path === ".env")?.file).toBeNull();
    expect(persisted.entries.find((entry) => entry.path === "README.md")?.file).toMatchObject({ normalizedText: "hello\n" });
    const recomputed = canonicalizeManifest({
      githubRepositoryId: persisted.githubRepositoryId, canonicalOwner: persisted.canonicalOwner,
      canonicalRepository: persisted.canonicalRepository, canonicalUrl: persisted.canonicalUrl,
      defaultBranch: persisted.defaultBranch, requestedRef: persisted.requestedRef,
      resolvedRef: persisted.resolvedRef, commitSha: persisted.commitSha, rootTreeSha: persisted.rootTreeSha,
      entries: persisted.entries.map((entry): SnapshotEntry => ({
        path: entry.path, mode: entry.mode, type: entry.objectType, objectSha: entry.objectSha,
        reportedSize: entry.reportedSize, decision: entry.decision,
        exclusionReason: entry.exclusionReason as SnapshotEntry["exclusionReason"],
        rawSha256: entry.file?.rawSha256 ?? null, normalizedSha256: entry.file?.normalizedSha256 ?? null,
        byteCount: entry.file?.byteCount ?? null, lineCount: entry.file?.lineCount ?? null,
      })),
    });
    expect(recomputed.hash).toBe(persisted.manifestHashSha256);
    const events = await db.selectFrom("investigation_events").selectAll().where("investigation_id", "=", investigation.id).where("type", "=", "repository_snapshot_persisted").execute();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ stage: "snapshotting", public_payload: { commitSha: "a".repeat(40), manifestHash: built.manifestHashSha256,
      inspectedEntryCount: 2, admittedFileCount: 1, excludedEntryCount: 1, totalAdmittedBytes: built.totalAdmittedBytes } });
    expect(JSON.stringify(persisted) + JSON.stringify(events)).not.toContain(SECRET_SENTINEL);
    const leaked = await sql<{ count: string }>`
      select (
        (select count(*) from repository_snapshot_files where normalized_text like ${`%${SECRET_SENTINEL}%`} or convert_from(raw_content, 'UTF8') like ${`%${SECRET_SENTINEL}%`}) +
        (select count(*) from repository_snapshot_entries where path like ${`%${SECRET_SENTINEL}%`}) +
        (select count(*) from investigation_events where public_payload::text like ${`%${SECRET_SENTINEL}%`})
      )::text count
    `.execute(db);
    expect(leaked.rows[0].count).toBe("0");
  });

  it("serializes concurrent creates and returns the winning immutable snapshot without duplicate events or files", async () => {
    const investigation = await snapshotting(), built = artifact();
    const results = await Promise.all(Array.from({ length: 6 }, () => snapshots.createForInvestigation(investigation.id, built)));
    expect(new Set(results.map((value) => value.id)).size).toBe(1);
    expect(await tableCount("repository_snapshots")).toBe(1);
    expect(await tableCount("repository_snapshot_entries")).toBe(2);
    expect(await tableCount("repository_snapshot_files")).toBe(1);
    expect(await db.selectFrom("investigation_events").select("sequence").where("type", "=", "repository_snapshot_persisted").execute()).toHaveLength(1);
  });

  it("replays existing snapshots and rejects wrong lifecycle or unknown investigations", async () => {
    const investigation = await snapshotting(), built = artifact();
    const first = await snapshots.createForInvestigation(investigation.id, built);
    const changed = { ...built, manifestHashSha256: "f".repeat(64) };
    expect((await snapshots.createForInvestigation(investigation.id, changed)).id).toBe(first.id);
    const waiting = await investigations.createInvestigation({ repositoryUrl: "https://github.com/Acme/Other", claim: { statement: "claim" } }, randomUUID());
    await expect(snapshots.createForInvestigation(waiting.id, built)).rejects.toMatchObject({ code: "invalid_lifecycle_transition" });
    await expect(snapshots.createForInvestigation(randomUUID(), built)).rejects.toMatchObject({ code: "not_found" });
  });

  it("rolls back every snapshot row and event on a forced file constraint failure", async () => {
    const investigation = await snapshotting();
    await db.schema.alterTable("repository_snapshot_files").addCheckConstraint("force_snapshot_failure", sql`false`).execute();
    await expect(snapshots.createForInvestigation(investigation.id, artifact())).rejects.toMatchObject({ code: "internal_error" });
    await db.schema.alterTable("repository_snapshot_files").dropConstraint("force_snapshot_failure").execute();
    expect(await tableCount("repository_snapshots")).toBe(0);
    expect(await tableCount("repository_snapshot_entries")).toBe(0);
    expect(await tableCount("repository_snapshot_files")).toBe(0);
    expect(await db.selectFrom("investigation_events").select("sequence").where("type", "=", "repository_snapshot_persisted").execute()).toHaveLength(0);
  });

  it("persists nothing for every fatal provider verification anomaly and permits one later healthy artifact", async () => {
    const investigation = await snapshotting();
    const raw = Buffer.from("safe!"), objectSha = createHash("sha1").update(`blob ${raw.byteLength}\0`).update(raw).digest("hex");
    const validBlob = { sha: objectSha, encoding: "base64", size: raw.byteLength, content: raw.toString("base64") };
    const anomalies: Array<{ blob: Record<string, unknown>; treeSize?: number }> = [
      { blob: { ...validBlob, sha: "f".repeat(40) } }, { blob: { ...validBlob, encoding: "utf-8" } },
      { blob: (() => { const { encoding: _encoding, ...rest } = validBlob; return rest; })() },
      { blob: { ...validBlob, content: "%%%=" } }, { blob: { ...validBlob, content: `${validBlob.content}\n` } },
      { blob: { ...validBlob, size: raw.byteLength + 1 } }, { blob: validBlob, treeSize: 1 },
      { blob: { ...validBlob, content: Buffer.from("other").toString("base64") } },
    ];
    for (const anomaly of anomalies) {
      const builder = async () => buildRepositorySnapshot({ owner: "Acme", repository: "Widget", requestedRef: null,
        config: githubConfig, client: new GitHubClient(githubConfig, async (input) => {
          const url = String(input);
          if (url.endsWith("/repos/Acme/Widget")) return new Response('{"id":9007199254740992,"name":"Widget","private":false,"archived":false,"disabled":false,"size":1,"default_branch":"main","owner":{"login":"Acme"}}');
          if (url.endsWith("/commits/main")) return new Response(JSON.stringify({ sha: "a".repeat(40), commit: { tree: { sha: "b".repeat(40) } } }));
          if (url.includes("/git/trees/")) return new Response(JSON.stringify({ sha: "b".repeat(40), truncated: false, tree: [
            { path: "file.txt", mode: "100644", type: "blob", sha: objectSha, size: anomaly.treeSize ?? raw.byteLength },
          ] }));
          if (url.includes("/git/blobs/")) return new Response(JSON.stringify(anomaly.blob));
          throw new Error("unexpected offline fixture request");
        }) });
      await expect(new RepositorySnapshotService(snapshots, builder).snapshotInvestigation(investigation.id))
        .rejects.toMatchObject({ failureCode: "blob_verification_failed" });
      expect(await tableCount("repository_snapshots")).toBe(0);
      expect(await tableCount("repository_snapshot_entries")).toBe(0);
      expect(await tableCount("repository_snapshot_files")).toBe(0);
      expect(await db.selectFrom("investigation_events").select("sequence").where("type", "=", "repository_snapshot_persisted").execute()).toHaveLength(0);
    }
    const healthy = new RepositorySnapshotService(snapshots, async () => artifact());
    await expect(healthy.snapshotInvestigation(investigation.id)).resolves.toMatchObject({ admittedFileCount: 1 });
    expect(await tableCount("repository_snapshots")).toBe(1);
  });

  it("enforces snapshot-entry relationships and cascade deletion directly", async () => {
    const investigation = await snapshotting(), persisted = await snapshots.createForInvestigation(investigation.id, artifact());
    const excluded = persisted.entries.find((entry) => entry.decision === "excluded")!;
    const admitted = persisted.entries.find((entry) => entry.decision === "admitted")!;
    await expect(sql`insert into repository_snapshot_files(id,snapshot_id,entry_id,entry_decision,raw_content,normalized_text,raw_sha256,normalized_sha256,byte_count,line_count,created_at)
      values (${randomUUID()},${persisted.id},${excluded.id},'admitted',${Buffer.from("x")},'x',${"a".repeat(64)},${"b".repeat(64)},1,1,now())`.execute(db)).rejects.toBeTruthy();
    const otherInvestigation = await snapshotting(), other = await snapshots.createForInvestigation(otherInvestigation.id, artifact());
    await expect(sql`insert into repository_snapshot_files(id,snapshot_id,entry_id,entry_decision,raw_content,normalized_text,raw_sha256,normalized_sha256,byte_count,line_count,created_at)
      values (${randomUUID()},${other.id},${admitted.id},'admitted',${Buffer.from("x")},'x',${"a".repeat(64)},${"b".repeat(64)},1,1,now())`.execute(db)).rejects.toBeTruthy();
    await db.deleteFrom("investigations").where("id", "=", investigation.id).execute();
    expect(await tableCount("repository_snapshots")).toBe(1);
  });

  it("rejects a missing admitted body before replay", async () => {
    const investigation = await snapshotting(), persisted = await snapshots.createForInvestigation(investigation.id, artifact());
    await db.deleteFrom("repository_snapshot_files").where("snapshot_id", "=", persisted.id).execute();
    await expect(snapshots.findByInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
  });

  it("rejects same-length raw substitution and normalized text drift before replay", async () => {
    const investigation = await snapshotting(), persisted = await snapshots.createForInvestigation(investigation.id, artifact());
    await db.updateTable("repository_snapshot_files").set({ raw_content: Buffer.from("jello\r\n") }).where("snapshot_id", "=", persisted.id).execute();
    await expect(snapshots.findByInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
    await db.updateTable("repository_snapshot_files").set({ raw_content: Buffer.from("hello\r\n"), normalized_text: "jello\n" }).where("snapshot_id", "=", persisted.id).execute();
    await expect(snapshots.findByInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
  });

  it("rejects stored raw hash, normalized hash, and line-count drift before replay", async () => {
    const investigation = await snapshotting(), persisted = await snapshots.createForInvestigation(investigation.id, artifact());
    const built = artifact(), admitted = built.entries.find((entry) => entry.decision === "admitted")!;
    await db.updateTable("repository_snapshot_files").set({ raw_sha256: "f".repeat(64) }).where("snapshot_id", "=", persisted.id).execute();
    await expect(snapshots.findByInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
    await db.updateTable("repository_snapshot_files").set({ raw_sha256: admitted.rawSha256!, normalized_sha256: "f".repeat(64) }).where("snapshot_id", "=", persisted.id).execute();
    await expect(snapshots.findByInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
    await db.updateTable("repository_snapshot_files").set({ normalized_sha256: admitted.normalizedSha256!, line_count: 2 }).where("snapshot_id", "=", persisted.id).execute();
    await expect(snapshots.findByInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
  });

  it("rejects a coherently rewritten body whose persisted Git object SHA is stale", async () => {
    const investigation = await snapshotting(), persisted = await snapshots.createForInvestigation(investigation.id, artifact());
    let githubBuilds = 0;
    const service = new RepositorySnapshotService(snapshots, async () => { githubBuilds++; return artifact(); });
    await expect(service.snapshotInvestigation(investigation.id)).resolves.toMatchObject({ id: persisted.id });
    expect(githubBuilds).toBe(0);

    const changedRaw = Buffer.from("jello\r\n"), changedText = "jello\n";
    const rawSha256 = createHash("sha256").update(changedRaw).digest("hex");
    const normalizedSha256 = createHash("sha256").update(changedText).digest("hex");
    const changedEntries = persisted.entries.map((entry): SnapshotEntry => ({
      path: entry.path, mode: entry.mode, type: entry.objectType, objectSha: entry.objectSha,
      reportedSize: entry.reportedSize, decision: entry.decision,
      exclusionReason: entry.exclusionReason as SnapshotEntry["exclusionReason"],
      rawSha256: entry.decision === "admitted" ? rawSha256 : null,
      normalizedSha256: entry.decision === "admitted" ? normalizedSha256 : null,
      byteCount: entry.decision === "admitted" ? changedRaw.byteLength : null,
      lineCount: entry.decision === "admitted" ? 1 : null,
    }));
    const manifest = canonicalizeManifest({ githubRepositoryId: persisted.githubRepositoryId,
      canonicalOwner: persisted.canonicalOwner, canonicalRepository: persisted.canonicalRepository,
      canonicalUrl: persisted.canonicalUrl, defaultBranch: persisted.defaultBranch,
      requestedRef: persisted.requestedRef, resolvedRef: persisted.resolvedRef,
      commitSha: persisted.commitSha, rootTreeSha: persisted.rootTreeSha, entries: changedEntries });
    await db.updateTable("repository_snapshot_files").set({ raw_content: changedRaw, normalized_text: changedText,
      raw_sha256: rawSha256, normalized_sha256: normalizedSha256, byte_count: changedRaw.byteLength, line_count: 1 })
      .where("snapshot_id", "=", persisted.id).execute();
    await db.updateTable("repository_snapshots").set({ total_admitted_bytes: String(changedRaw.byteLength),
      manifest_hash_sha256: manifest.hash }).where("id", "=", persisted.id).execute();

    await expect(snapshots.findByInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
    await expect(service.snapshotInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
    expect(githubBuilds).toBe(0);
    expect(await tableCount("repository_snapshots")).toBe(1);
    expect(await tableCount("repository_snapshot_entries")).toBe(2);
    expect(await tableCount("repository_snapshot_files")).toBe(1);
    expect((await db.selectFrom("repository_snapshots").select("id").where("investigation_id", "=", investigation.id).executeTakeFirstOrThrow()).id).toBe(persisted.id);
  });

  it("rejects count, order, and manifest identity drift before replay", async () => {
    const investigation = await snapshotting(), persisted = await snapshots.createForInvestigation(investigation.id, artifact());
    await db.updateTable("repository_snapshots").set({ admitted_file_count: 0, excluded_entry_count: 2, total_admitted_bytes: "0" }).where("id", "=", persisted.id).execute();
    await expect(snapshots.findByInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
    let githubBuilds = 0;
    const service = new RepositorySnapshotService(snapshots, async () => { githubBuilds++; return artifact(); });
    await expect(service.snapshotInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
    expect(githubBuilds).toBe(0);
    await db.updateTable("repository_snapshots").set({ admitted_file_count: 1, excluded_entry_count: 1, total_admitted_bytes: artifact().totalAdmittedBytes }).where("id", "=", persisted.id).execute();
    await db.updateTable("repository_snapshot_entries").set({ manifest_order: 2 }).where("snapshot_id", "=", persisted.id).where("path", "=", ".env").execute();
    await expect(snapshots.findByInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
    await db.updateTable("repository_snapshot_entries").set({ manifest_order: 0 }).where("snapshot_id", "=", persisted.id).where("path", "=", ".env").execute();
    await db.updateTable("repository_snapshots").set({ manifest_hash_sha256: "f".repeat(64) }).where("id", "=", persisted.id).execute();
    await expect(snapshots.findByInvestigation(investigation.id)).rejects.toMatchObject({ code: "internal_error" });
  });
});

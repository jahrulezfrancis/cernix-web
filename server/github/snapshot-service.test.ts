import { describe, expect, it, vi } from "vitest";
import { RepositorySnapshotService } from "./snapshot-service";
import type { RepositorySnapshotRepository, PersistedRepositorySnapshot } from "@/server/persistence/repository-snapshot-repository";

const context = { id: "11111111-1111-4111-8111-111111111111", status: "snapshotting" as const,
  repositoryOwner: "Acme", repositoryName: "Widget", requestedRef: null };
const persisted = { id: "snapshot", investigationId: context.id } as PersistedRepositorySnapshot;

function repository(overrides: Record<string, unknown> = {}) {
  return { loadInvestigationContext: vi.fn(async () => context), findByInvestigation: vi.fn(async () => null),
    createForInvestigation: vi.fn(async () => persisted), ...overrides } as unknown as RepositorySnapshotRepository;
}

describe("snapshot persistence service", () => {
  it("returns an existing complete snapshot before any GitHub builder work", async () => {
    const repo = repository({ findByInvestigation: vi.fn(async () => persisted) });
    const build = vi.fn();
    await expect(new RepositorySnapshotService(repo, build).snapshotInvestigation(context.id)).resolves.toBe(persisted);
    expect(build).not.toHaveBeenCalled();
  });

  it("builds outside persistence and forwards only canonical investigation coordinates", async () => {
    const order: string[] = [], repo = repository({
      createForInvestigation: vi.fn(async () => { order.push("persist"); return persisted; }),
    });
    const artifact = { marker: true } as never;
    const build = vi.fn(async (input) => { order.push("build"); expect(input).toMatchObject({ owner: "Acme", repository: "Widget", requestedRef: null }); return artifact; });
    await new RepositorySnapshotService(repo, build).snapshotInvestigation(context.id);
    expect(order).toEqual(["build", "persist"]);
  });

  it("rejects a wrong lifecycle without GitHub work", async () => {
    const repo = repository({ loadInvestigationContext: vi.fn(async () => ({ ...context, status: "planning" })) });
    const build = vi.fn();
    await expect(new RepositorySnapshotService(repo, build).snapshotInvestigation(context.id))
      .rejects.toMatchObject({ code: "invalid_lifecycle_transition" });
    expect(build).not.toHaveBeenCalled();
  });
});

import type { SnapshotArtifact } from "./contracts";
import type { RepositorySnapshotRepository, PersistedRepositorySnapshot } from "@/server/persistence/repository-snapshot-repository";
import { ApplicationError } from "@/server/errors";

export type SnapshotArtifactBuilder = (input: {
  owner: string; repository: string; requestedRef: string | null; signal?: AbortSignal;
}) => Promise<SnapshotArtifact>;

export class RepositorySnapshotService {
  constructor(private readonly repository: RepositorySnapshotRepository, private readonly build: SnapshotArtifactBuilder) {}

  async snapshotInvestigation(investigationId: unknown, signal?: AbortSignal): Promise<PersistedRepositorySnapshot> {
    const context = await this.repository.loadInvestigationContext(investigationId);
    const existing = await this.repository.findByInvestigation(context.id);
    if (existing) return existing;
    if (context.status !== "snapshotting") throw new ApplicationError("invalid_lifecycle_transition", {});
    const artifact = await this.build({ owner: context.repositoryOwner, repository: context.repositoryName, requestedRef: context.requestedRef, signal });
    return this.repository.createForInvestigation(context.id, artifact);
  }
}

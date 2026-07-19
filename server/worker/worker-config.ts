import { randomUUID } from "node:crypto";

export type SnapshotWorkerConfig = Readonly<{
  owner: string; leaseSeconds: number; heartbeatSeconds: number; pollMs: number;
  maxAttempts: number; retryBaseSeconds: number; retryMaxSeconds: number;
}>;

const OWNER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
type Environment = Readonly<Record<string, string | undefined>>;
function integer(environment: Environment, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new Error(`Invalid ${name}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}.`);
  return value;
}

export function readSnapshotJobMaxAttempts(environment: Environment = process.env): number {
  return integer(environment, "CERNIX_SNAPSHOT_MAX_ATTEMPTS", 4, 1, 10);
}

export function readSnapshotWorkerConfig(environment: Environment = process.env,
  uuid: () => string = randomUUID): SnapshotWorkerConfig {
  const configuredOwner = environment.CERNIX_SNAPSHOT_WORKER_OWNER;
  const owner = configuredOwner ? configuredOwner : `worker-${uuid()}`;
  if (!OWNER.test(owner)) throw new Error("Invalid CERNIX_SNAPSHOT_WORKER_OWNER.");
  const leaseSeconds = integer(environment, "CERNIX_SNAPSHOT_LEASE_SECONDS", 120, 30, 900);
  const heartbeatSeconds = integer(environment, "CERNIX_SNAPSHOT_HEARTBEAT_SECONDS", 30, 1, 449);
  const pollMs = integer(environment, "CERNIX_SNAPSHOT_POLL_MS", 1_000, 250, 30_000);
  const maxAttempts = readSnapshotJobMaxAttempts(environment);
  const retryBaseSeconds = integer(environment, "CERNIX_SNAPSHOT_RETRY_BASE_SECONDS", 5, 1, 300);
  const retryMaxSeconds = integer(environment, "CERNIX_SNAPSHOT_RETRY_MAX_SECONDS", 300, 1, 3_600);
  if (heartbeatSeconds * 2 >= leaseSeconds) throw new Error("Snapshot heartbeat must be less than half the lease duration.");
  if (retryBaseSeconds > retryMaxSeconds) throw new Error("Snapshot retry base must not exceed its maximum.");
  return Object.freeze({ owner, leaseSeconds, heartbeatSeconds, pollMs, maxAttempts, retryBaseSeconds, retryMaxSeconds });
}

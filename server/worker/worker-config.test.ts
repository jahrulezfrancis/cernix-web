import { describe, expect, it } from "vitest";
import { readSnapshotJobMaxAttempts, readSnapshotWorkerConfig } from "./worker-config";

describe("snapshot worker configuration", () => {
  it("loads bounded defaults lazily and generates an opaque owner", () => {
    expect(readSnapshotJobMaxAttempts({})).toBe(4);
    expect(readSnapshotWorkerConfig({}, () => "11111111-1111-4111-8111-111111111111")).toEqual({
      owner: "worker-11111111-1111-4111-8111-111111111111", leaseSeconds: 120,
      heartbeatSeconds: 30, pollMs: 1_000, maxAttempts: 4, retryBaseSeconds: 5, retryMaxSeconds: 300,
    });
  });

  it("accepts every inclusive numeric boundary and a safe explicit owner", () => {
    expect(readSnapshotWorkerConfig({ CERNIX_SNAPSHOT_WORKER_OWNER: "worker.alpha:1",
      CERNIX_SNAPSHOT_LEASE_SECONDS: "30", CERNIX_SNAPSHOT_HEARTBEAT_SECONDS: "1",
      CERNIX_SNAPSHOT_POLL_MS: "250", CERNIX_SNAPSHOT_MAX_ATTEMPTS: "1",
      CERNIX_SNAPSHOT_RETRY_BASE_SECONDS: "1", CERNIX_SNAPSHOT_RETRY_MAX_SECONDS: "1" }).owner).toBe("worker.alpha:1");
    expect(readSnapshotWorkerConfig({ CERNIX_SNAPSHOT_LEASE_SECONDS: "900",
      CERNIX_SNAPSHOT_HEARTBEAT_SECONDS: "449", CERNIX_SNAPSHOT_POLL_MS: "30000",
      CERNIX_SNAPSHOT_MAX_ATTEMPTS: "10", CERNIX_SNAPSHOT_RETRY_BASE_SECONDS: "300",
      CERNIX_SNAPSHOT_RETRY_MAX_SECONDS: "3600" })).toMatchObject({ leaseSeconds: 900,
      heartbeatSeconds: 449, pollMs: 30_000, maxAttempts: 10, retryBaseSeconds: 300, retryMaxSeconds: 3_600 });
  });

  it.each(["-1", "0", "1.5", "1e2", "NaN", "Infinity", "999999999999999999999"])(
    "rejects invalid strict numeric syntax %s", (value) => {
      expect(() => readSnapshotWorkerConfig({ CERNIX_SNAPSHOT_LEASE_SECONDS: value })).toThrow();
    });

  it("rejects incoherent heartbeat/retry bounds and unsafe owners", () => {
    expect(() => readSnapshotWorkerConfig({ CERNIX_SNAPSHOT_LEASE_SECONDS: "60", CERNIX_SNAPSHOT_HEARTBEAT_SECONDS: "30" })).toThrow();
    expect(() => readSnapshotWorkerConfig({ CERNIX_SNAPSHOT_RETRY_BASE_SECONDS: "10", CERNIX_SNAPSHOT_RETRY_MAX_SECONDS: "9" })).toThrow();
    for (const owner of [" bad", "two words", "a".repeat(129), "bad\nowner"]) {
      expect(() => readSnapshotWorkerConfig({ CERNIX_SNAPSHOT_WORKER_OWNER: owner })).toThrow();
    }
  });
});

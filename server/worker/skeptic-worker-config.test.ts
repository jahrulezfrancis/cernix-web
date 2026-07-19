import { describe, expect, it } from "vitest";
import { readSkepticJobMaxAttempts, readSkepticWorkerConfig } from "./skeptic-worker-config";

describe("skeptic worker config", () => {
  it("reads defaults and bounded overrides", () => {
    expect(readSkepticJobMaxAttempts({ CERNIX_SKEPTIC_MAX_ATTEMPTS: "6" })).toBe(6);
    expect(readSkepticWorkerConfig({ CERNIX_SKEPTIC_HEARTBEAT_SECONDS: "45", CERNIX_SKEPTIC_LEASE_SECONDS: "180" }))
      .toMatchObject({ heartbeatSeconds: 45, leaseSeconds: 180, pollMs: 1_000 });
  });

  it("rejects invalid heartbeat and lease combinations", () => {
    expect(() => readSkepticWorkerConfig({ CERNIX_SKEPTIC_HEARTBEAT_SECONDS: "120", CERNIX_SKEPTIC_LEASE_SECONDS: "180" }))
      .toThrow(/heartbeat/i);
  });
});

import { describe, expect, it } from "vitest";
import { readPlanningJobMaxAttempts, readPlanningWorkerConfig } from "./planning-worker-config";

describe("planning worker configuration", () => {
  it("loads bounded defaults lazily and generates an opaque owner", () => {
    const config = readPlanningWorkerConfig({});
    expect(config.leaseSeconds).toBe(120);
    expect(config.owner).toMatch(/^planning-[0-9a-f-]{36}$/);
  });

  it("accepts every inclusive numeric boundary and a safe explicit owner", () => {
    expect(readPlanningWorkerConfig({
      CERNIX_PLANNING_WORKER_OWNER: "worker.planning-1",
      CERNIX_PLANNING_LEASE_SECONDS: "900",
      CERNIX_PLANNING_HEARTBEAT_SECONDS: "449",
      CERNIX_PLANNING_POLL_MS: "30000",
      CERNIX_PLANNING_MAX_ATTEMPTS: "10",
      CERNIX_PLANNING_RETRY_BASE_SECONDS: "300",
      CERNIX_PLANNING_RETRY_MAX_SECONDS: "3600",
    })).toMatchObject({ owner: "worker.planning-1", leaseSeconds: 900, heartbeatSeconds: 449, pollMs: 30_000, maxAttempts: 10 });
  });

  it("rejects incoherent heartbeat/retry bounds and unsafe owners", () => {
    expect(() => readPlanningWorkerConfig({ CERNIX_PLANNING_HEARTBEAT_SECONDS: "450" })).toThrow();
    expect(() => readPlanningWorkerConfig({ CERNIX_PLANNING_RETRY_BASE_SECONDS: "301" })).toThrow();
    expect(() => readPlanningWorkerConfig({ CERNIX_PLANNING_WORKER_OWNER: "bad owner" })).toThrow();
  });
});

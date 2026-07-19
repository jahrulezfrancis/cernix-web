import { describe, expect, it } from "vitest";
import { readEvidenceJobMaxAttempts, readEvidenceWorkerConfig } from "./evidence-worker-config";

describe("evidence worker config", () => {
  it("loads bounded defaults lazily and generates an opaque owner", () => {
    const config = readEvidenceWorkerConfig({});
    expect(config).toMatchObject({ leaseSeconds: 180, heartbeatSeconds: 45, pollMs: 1_000,
      maxAttempts: 4, retryBaseSeconds: 5, retryMaxSeconds: 300 });
    expect(config.owner).toMatch(/^evidence-[0-9a-f-]{36}$/);
    expect(readEvidenceJobMaxAttempts({ CERNIX_EVIDENCE_MAX_ATTEMPTS: "6" })).toBe(6);
    expect(() => readEvidenceWorkerConfig({ CERNIX_EVIDENCE_HEARTBEAT_SECONDS: "120", CERNIX_EVIDENCE_LEASE_SECONDS: "180" }))
      .toThrow(/heartbeat/i);
  });
});

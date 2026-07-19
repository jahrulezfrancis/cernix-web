import { describe, expect, it } from "vitest";
import { readJudgeJobMaxAttempts, readJudgeWorkerConfig } from "./judge-worker-config";

describe("judge worker config", () => {
  it("reads defaults and bounded overrides", () => {
    expect(readJudgeJobMaxAttempts({ CERNIX_JUDGE_MAX_ATTEMPTS: "5" })).toBe(5);
    expect(readJudgeWorkerConfig({ CERNIX_JUDGE_HEARTBEAT_SECONDS: "45", CERNIX_JUDGE_LEASE_SECONDS: "180" }))
      .toMatchObject({ heartbeatSeconds: 45, leaseSeconds: 180 });
  });
});

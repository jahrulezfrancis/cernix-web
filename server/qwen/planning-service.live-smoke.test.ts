import { describe, expect, it } from "vitest";

describe("opt-in pinned Qwen planning smoke", () => {
  it("generates a schema-valid plan for the pinned fixture", async (context) => {
    const environment = process.env;
    if (environment.CERNIX_QWEN_LIVE_SMOKE !== "1" || !environment.QWEN_API_KEY) {
      context.skip(); return;
    }
    const { resetQwenPlanningConfigForTests } = await import("./server-config");
    resetQwenPlanningConfigForTests();
    const { InvestigationPlanningService } = await import("./planning-service");
    const { QwenClient } = await import("./client");
    const { parseQwenPlanningConfig } = await import("./config");
    const config = parseQwenPlanningConfig(environment);
    const plans = {
      loadPlanningContext: async () => ({
        investigationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "planning",
        claim: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", statement: "The repository exposes a README file.", preservedQualifiers: [] },
        snapshot: {
          manifestHashSha256: "c".repeat(64), commitSha: "d".repeat(40), entries: [],
          inspectedEntryCount: 1, admittedFileCount: 1, excludedEntryCount: 0, totalAdmittedBytes: "5",
        },
      }),
      findByInvestigation: async () => null,
      createForInvestigation: async (_id: string, artifact: unknown) => ({ id: "plan", artifact }),
    };
    const result = await new InvestigationPlanningService(plans as never, new QwenClient(config), config)
      .generatePlan("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(result.artifact.claimPlans.length).toBeGreaterThan(0);
  });
});

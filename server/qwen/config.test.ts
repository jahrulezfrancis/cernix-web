import { describe, expect, it } from "vitest";
import { QWEN_API_ORIGIN, QWEN_API_ORIGIN_INTL } from "./contracts";
import { parseQwenPlanningConfig } from "./config";

describe("qwen planning configuration", () => {
  it("requires a bounded API key and applies defaults", () => {
    expect(() => parseQwenPlanningConfig({})).toThrow();
    const config = parseQwenPlanningConfig({ QWEN_API_KEY: "test-key" });
    expect(config.modelId).toBe("qwen-plus");
    expect(config.promptVersion).toBe("planning-v1");
    expect(config.requestTimeoutMs).toBe(30_000);
  });

  it("rejects unsafe origins and invalid model identifiers", () => {
    expect(() => parseQwenPlanningConfig({ QWEN_API_KEY: "k", QWEN_API_ORIGIN: "https://evil.example" })).toThrow();
    expect(() => parseQwenPlanningConfig({ QWEN_API_KEY: "k", QWEN_MODEL_ID: "bad model" })).toThrow();
  });

  it("accepts the international DashScope origin", () => {
    const config = parseQwenPlanningConfig({ QWEN_API_KEY: "k", QWEN_API_ORIGIN: QWEN_API_ORIGIN_INTL });
    expect(config.apiOrigin).toBe(QWEN_API_ORIGIN_INTL);
    expect(parseQwenPlanningConfig({ QWEN_API_KEY: "k" }).apiOrigin).toBe(QWEN_API_ORIGIN);
  });
});

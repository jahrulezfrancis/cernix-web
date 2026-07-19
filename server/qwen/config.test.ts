import { describe, expect, it } from "vitest";
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
});

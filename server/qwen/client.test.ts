import { describe, expect, it, vi } from "vitest";
import { QwenClient } from "./client";
import { PlanningError } from "./errors";

const config = {
  apiKey: "test-key", apiOrigin: "https://dashscope.aliyuncs.com" as const, modelId: "qwen-plus",
  promptVersion: "planning-v1", requestTimeoutMs: 5_000, planningDeadlineMs: 10_000,
  maxOutputTokens: 1024, maxContextBytes: 65_536, maxResponseBytes: 8_192,
};

describe("qwen client", () => {
  it("returns parsed chat completion responses", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "{\"claimPlans\":[]}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { status: 200 }));
    const response = await new QwenClient(config, fetchImpl).createChatCompletion({
      model: "qwen-plus", messages: [{ role: "user", content: "hi" }], max_tokens: 100, temperature: 0,
    });
    expect(response.usage?.prompt_tokens).toBe(10);
  });

  it("classifies rate limits and oversized bodies without leaking provider text", async () => {
    await expect(new QwenClient(config, vi.fn(async () => new Response("{}", { status: 429 }))).createChatCompletion({
      model: "qwen-plus", messages: [{ role: "user", content: "hi" }], max_tokens: 100, temperature: 0,
    })).rejects.toMatchObject({ failureCode: "qwen_rate_limited" });
    const huge = new Uint8Array(config.maxResponseBytes + 1);
    await expect(new QwenClient(config, vi.fn(async () => new Response(huge, { status: 200 }))).createChatCompletion({
      model: "qwen-plus", messages: [{ role: "user", content: "hi" }], max_tokens: 100, temperature: 0,
    })).rejects.toBeInstanceOf(PlanningError);
  });
});

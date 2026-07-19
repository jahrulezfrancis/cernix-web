import { ApplicationError } from "@/server/errors";
import { QWEN_API_ORIGIN } from "./contracts";

export type QwenPlanningConfig = Readonly<{
  apiKey: string;
  apiOrigin: typeof QWEN_API_ORIGIN;
  modelId: string;
  promptVersion: string;
  requestTimeoutMs: number;
  planningDeadlineMs: number;
  maxOutputTokens: number;
  maxContextBytes: number;
  maxResponseBytes: number;
}>;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROMPT_VERSION = /^[a-z][a-z0-9_-]{0,63}$/;
type Environment = Readonly<Record<string, string | undefined>>;

function integer(environment: Environment, name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = environment[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new ApplicationError("dependency_unavailable", {});
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ApplicationError("dependency_unavailable", {});
  }
  return value;
}

export function parseQwenPlanningConfig(environment: Environment): QwenPlanningConfig {
  const apiKey = environment.QWEN_API_KEY?.trim();
  if (!apiKey || apiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(apiKey)) {
    throw new ApplicationError("dependency_unavailable", {});
  }
  const modelId = environment.QWEN_MODEL_ID?.trim() || "qwen-plus";
  const promptVersion = environment.QWEN_PROMPT_VERSION?.trim() || "planning-v1";
  if (!MODEL_ID.test(modelId) || !PROMPT_VERSION.test(promptVersion)) {
    throw new ApplicationError("dependency_unavailable", {});
  }
  const apiOrigin = environment.QWEN_API_ORIGIN?.trim();
  if (apiOrigin && apiOrigin !== QWEN_API_ORIGIN) throw new ApplicationError("dependency_unavailable", {});
  return Object.freeze({
    apiKey,
    apiOrigin: QWEN_API_ORIGIN,
    modelId,
    promptVersion,
    requestTimeoutMs: integer(environment, "QWEN_REQUEST_TIMEOUT_MS", 30_000, 1_000, 120_000),
    planningDeadlineMs: integer(environment, "QWEN_PLANNING_DEADLINE_MS", 120_000, 5_000, 300_000),
    maxOutputTokens: integer(environment, "QWEN_MAX_OUTPUT_TOKENS", 4_096, 256, 16_384),
    maxContextBytes: integer(environment, "QWEN_MAX_CONTEXT_BYTES", 65_536, 1_024, 262_144),
    maxResponseBytes: integer(environment, "QWEN_MAX_RESPONSE_BYTES", 131_072, 1_024, 524_288),
  });
}

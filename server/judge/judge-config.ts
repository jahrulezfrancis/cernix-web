export const DEFAULT_JUDGE_MAX_CONTEXT_BYTES = 64_000;

export type JudgeContextConfig = Readonly<{ maxContextBytes: number }>;

export function parseJudgeContextConfig(environment: Readonly<Record<string, string | undefined>> = process.env): JudgeContextConfig {
  const raw = environment.CERNIX_JUDGE_MAX_CONTEXT_BYTES;
  if (raw === undefined || raw === "") return Object.freeze({ maxContextBytes: DEFAULT_JUDGE_MAX_CONTEXT_BYTES });
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new Error("Invalid CERNIX_JUDGE_MAX_CONTEXT_BYTES.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 4_096 || value > 256_000) throw new Error("Invalid CERNIX_JUDGE_MAX_CONTEXT_BYTES.");
  return Object.freeze({ maxContextBytes: value });
}

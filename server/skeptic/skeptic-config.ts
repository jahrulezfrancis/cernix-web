export const DEFAULT_SKEPTIC_MAX_CONTEXT_BYTES = 48_000;

export type SkepticContextConfig = Readonly<{ maxContextBytes: number }>;

export function parseSkepticContextConfig(environment: Readonly<Record<string, string | undefined>> = process.env): SkepticContextConfig {
  const raw = environment.CERNIX_SKEPTIC_MAX_CONTEXT_BYTES;
  if (raw === undefined || raw === "") return Object.freeze({ maxContextBytes: DEFAULT_SKEPTIC_MAX_CONTEXT_BYTES });
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new Error("Invalid CERNIX_SKEPTIC_MAX_CONTEXT_BYTES.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 4_096 || value > 256_000) throw new Error("Invalid CERNIX_SKEPTIC_MAX_CONTEXT_BYTES.");
  return Object.freeze({ maxContextBytes: value });
}

export function readMaxReinvestigationCycles(environment: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = environment.CERNIX_MAX_REINVESTIGATION_CYCLES;
  if (raw === undefined || raw === "") return 1;
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new Error("Invalid CERNIX_MAX_REINVESTIGATION_CYCLES.");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 10) throw new Error("Invalid CERNIX_MAX_REINVESTIGATION_CYCLES.");
  return value;
}

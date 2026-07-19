export const DEFAULT_MAX_EXCERPTS = 12;
export const DEFAULT_MAX_EXCERPT_BYTES = 4_096;
export const DEFAULT_MAX_MATCHES_PER_TERM = 8;
export const DEFAULT_MAX_CONTEXT_BYTES = 48_000;
export const DEFAULT_EXCERPT_CONTEXT_LINES = 3;

export type RetrievalConfig = Readonly<{
  maxExcerpts: number;
  maxExcerptBytes: number;
  maxMatchesPerTerm: number;
  maxContextBytes: number;
  excerptContextLines: number;
}>;

export function parseRetrievalConfig(environment: Readonly<Record<string, string | undefined>> = process.env): RetrievalConfig {
  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = environment[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^(?:0|[1-9]\d*)$/.test(raw)) throw new Error(`Invalid ${name}.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}.`);
    return value;
  };
  return Object.freeze({
    maxExcerpts: integer("CERNIX_EVIDENCE_MAX_EXCERPTS", DEFAULT_MAX_EXCERPTS, 1, 50),
    maxExcerptBytes: integer("CERNIX_EVIDENCE_MAX_EXCERPT_BYTES", DEFAULT_MAX_EXCERPT_BYTES, 256, 32_768),
    maxMatchesPerTerm: integer("CERNIX_EVIDENCE_MAX_MATCHES_PER_TERM", DEFAULT_MAX_MATCHES_PER_TERM, 1, 50),
    maxContextBytes: integer("CERNIX_EVIDENCE_MAX_CONTEXT_BYTES", DEFAULT_MAX_CONTEXT_BYTES, 4_096, 256_000),
    excerptContextLines: integer("CERNIX_EVIDENCE_EXCERPT_CONTEXT_LINES", DEFAULT_EXCERPT_CONTEXT_LINES, 0, 20),
  });
}

import type { PersistedRepositorySnapshot } from "@/server/persistence/repository-snapshot-repository";
import type { RetrievalConfig } from "./retrieval-config";

export type RetrievalMatch = Readonly<{
  path: string;
  lineStart: number;
  lineEnd: number;
  normalizedSha256: string;
  excerptText: string;
  matchedTerm: string;
}>;

export type RetrievalBundle = Readonly<{
  queryTerms: readonly string[];
  matches: readonly RetrievalMatch[];
}>;

function buildExcerpt(lines: string[], centerLine: number, contextLines: number, maxBytes: number): { lineStart: number; lineEnd: number; text: string } {
  const start = Math.max(1, centerLine - contextLines);
  const end = Math.min(lines.length, centerLine + contextLines);
  let text = lines.slice(start - 1, end).join("\n");
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    text = text.slice(0, maxBytes);
  }
  return { lineStart: start, lineEnd: end, text };
}

export function retrieveFromSnapshot(snapshot: PersistedRepositorySnapshot, queryTerms: readonly string[],
  config: RetrievalConfig): RetrievalBundle {
  const terms = [...new Set(queryTerms.map((term) => term.trim().toLowerCase()).filter(Boolean))];
  const matches: RetrievalMatch[] = [];
  const seen = new Set<string>();
  for (const entry of snapshot.entries) {
    if (entry.decision !== "admitted" || !entry.file) continue;
    const lines = entry.file.normalizedText.split("\n");
  outer:
    for (const term of terms) {
      let termMatches = 0;
      for (let index = 0; index < lines.length; index++) {
        if (!lines[index].toLowerCase().includes(term)) continue;
        const excerpt = buildExcerpt(lines, index + 1, config.excerptContextLines, config.maxExcerptBytes);
        const key = `${entry.path}:${excerpt.lineStart}:${excerpt.lineEnd}:${term}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({
          path: entry.path,
          lineStart: excerpt.lineStart,
          lineEnd: excerpt.lineEnd,
          normalizedSha256: entry.file.normalizedSha256,
          excerptText: excerpt.text,
          matchedTerm: term,
        });
        termMatches++;
        if (termMatches >= config.maxMatchesPerTerm || matches.length >= config.maxExcerpts) break outer;
      }
    }
    if (matches.length >= config.maxExcerpts) break;
  }
  return { queryTerms: terms, matches };
}

export function serializeRetrievalBundle(bundle: RetrievalBundle): string {
  return JSON.stringify(bundle);
}

export function retrievalBundleWithinLimit(bundle: RetrievalBundle, maxBytes: number): boolean {
  return Buffer.byteLength(serializeRetrievalBundle(bundle), "utf8") <= maxBytes;
}

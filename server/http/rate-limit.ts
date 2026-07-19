import { ApplicationError } from "@/server/errors";

type Bucket = Readonly<{ count: number; resetAt: number }>;

const buckets = new Map<string, Bucket>();

export function resetRateLimitsForTests(): void {
  buckets.clear();
}

export function checkRateLimit(key: string, options: Readonly<{
  limit: number;
  windowMs: number;
  now?: number;
}>): void {
  const now = options.now ?? Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }
  if (existing.count >= options.limit) {
    throw new ApplicationError("rate_limited", {});
  }
  buckets.set(key, { count: existing.count + 1, resetAt: existing.resetAt });
}

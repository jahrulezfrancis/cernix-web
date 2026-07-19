import { SnapshotError } from "./errors";

export type TimeSource = Readonly<{
  now(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
  random(): number;
}>;

export const systemTimeSource: TimeSource = Object.freeze({
  now: () => Date.now(),
  random: () => Math.random(),
  sleep: (milliseconds, signal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); cleanup(); reject(signal?.reason); };
    signal?.addEventListener("abort", abort, { once: true });
  }),
});

export class SnapshotRequestBudget {
  readonly startedAt: number;
  readonly deadlineAt: number;
  private count = 0;

  constructor(private readonly maximum: number, deadlineMs: number, private readonly time: TimeSource) {
    this.startedAt = time.now();
    this.deadlineAt = this.startedAt + deadlineMs;
  }

  claim(signal?: AbortSignal): number {
    if (signal?.aborted) throw new SnapshotError("github_unavailable");
    this.assertTime();
    if (this.count >= this.maximum) throw new SnapshotError("request_budget_exceeded");
    const claimed = ++this.count;
    if (signal?.aborted) throw new SnapshotError("github_unavailable");
    return claimed;
  }

  assertTime(): void {
    if (this.time.now() >= this.deadlineAt) throw new SnapshotError("snapshot_deadline_exceeded");
  }

  remainingTime(): number {
    this.assertTime();
    return this.deadlineAt - this.time.now();
  }

  get requestCount(): number { return this.count; }
}

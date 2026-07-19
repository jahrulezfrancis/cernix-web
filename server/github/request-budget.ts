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
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
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

  claim(): number {
    this.assertTime();
    if (this.count >= this.maximum) throw new SnapshotError("request_budget_exceeded");
    return ++this.count;
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

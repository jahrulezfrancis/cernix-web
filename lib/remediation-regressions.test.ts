import { beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardRoute } from "./dashboard-routing";
import { buildMockReport } from "./mock-report-generator";
import {
  __resetRepositoryForTests,
  __storageKeyForTests,
  beginInvestigation,
  completeInvestigation,
  createInvestigation,
  getInvestigation,
  getStorageHealth,
  listInvestigations,
  requestTransition,
} from "./investigation-repository";
import type { InvestigationSimulationState } from "./types";

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const input = {
  repositoryUrl: "https://github.com/acme/widget",
  branch: "main",
  submissionType: "hackathon_submission" as const,
  description: "A sufficiently detailed project description for regression testing.",
  repositoryMetadata: { commitSha: "abcdef123456", language: "TypeScript", sizeKb: 10, fileCount: 5, hasTests: true, hasWorkflows: true },
};
const completedState = (updatedAt: string): InvestigationSimulationState => ({ stepIndex: 6, elapsedSeconds: 12, running: false, visibleEventIds: [], completed: true, updatedAt });

describe("merge-blocker regressions", () => {
  let localStorage: MemoryStorage;
  beforeEach(() => {
    localStorage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage });
    __resetRepositoryForTests();
    vi.useRealTimers();
  });

  it("treats cleared available storage as an empty durable store", () => {
    const investigation = createInvestigation(input);
    expect(getInvestigation(investigation.id)).not.toBeNull();
    localStorage.clear();
    expect(listInvestigations()).toEqual([]);
    expect(getInvestigation(investigation.id)).toBeNull();
    expect(getStorageHealth().status).toBe("available");
  });

  it("rejects a completed record whose report is missing required structure", () => {
    const investigation = createInvestigation(input);
    beginInvestigation(investigation.id);
    const report = buildMockReport(getInvestigation(investigation.id)!, 12);
    completeInvestigation(investigation.id, report, completedState(report.investigationDate));
    const envelope = JSON.parse(localStorage.getItem(__storageKeyForTests)!);
    delete envelope.investigations[investigation.id].report.repositorySnapshot;
    localStorage.setItem(__storageKeyForTests, JSON.stringify(envelope));
    __resetRepositoryForTests();
    expect(getInvestigation(investigation.id)).toBeNull();
    expect(getStorageHealth().status).toBe("malformed");
  });

  it("never gives demo or failed dashboard rows a navigation target", () => {
    const investigation = createInvestigation(input);
    expect(dashboardRoute(investigation, true)).toBeNull();
    expect(dashboardRoute(investigation)).toBe(`/investigations/${investigation.id}/claims`);
    const failure = requestTransition(investigation.id, "failed").investigation!;
    expect(dashboardRoute(failure)).toBeNull();
  });

  it("returns explicit allowed and changed transition outcomes", () => {
    const investigation = createInvestigation(input);
    expect(requestTransition(investigation.id, "investigating")).toMatchObject({ allowed: true, changed: true });
    expect(requestTransition(investigation.id, "investigating")).toMatchObject({ allowed: true, changed: false });
    expect(requestTransition(investigation.id, "awaiting_claim_review")).toMatchObject({ allowed: false, changed: false });
  });

  it("uses one real completion timestamp and preserves it idempotently", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const investigation = createInvestigation(input);
    beginInvestigation(investigation.id);
    const report = buildMockReport(getInvestigation(investigation.id)!, 12);
    const first = completeInvestigation(investigation.id, report, completedState(report.investigationDate))!;
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
    const second = completeInvestigation(investigation.id, report, completedState(report.investigationDate))!;
    expect(first.completedAt).toBe("2026-07-17T12:00:00.000Z");
    expect(first.report?.investigationDate).toBe(first.completedAt);
    expect(Object.values(first.report!.judgments).every((judgment) => judgment.issuedAt === first.completedAt)).toBe(true);
    expect(second.report).toEqual(first.report);
  });

  it("keeps fallback IDs unique when Web Crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Date, "now").mockReturnValue(12345);
    const first = createInvestigation(input);
    const second = createInvestigation(input);
    expect(first.id).not.toBe(second.id);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { canTransitionStatus } from "./investigation-lifecycle";
import { buildMockReport } from "./mock-report-generator";
import { advanceSimulation, pauseSimulation, resumeSimulation } from "./simulation-state";
import { __resetRepositoryForTests, __storageKeyForTests, beginInvestigation, completeInvestigation, createInvestigation, getInvestigation, getStorageHealth, saveClaims, saveSimulationState, transitionInvestigation } from "./investigation-repository";
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
const input = { repositoryUrl: "https://github.com/acme/widget", branch: "main", submissionType: "hackathon_submission" as const, description: "A sufficiently detailed project description for testing.", repositoryMetadata: { commitSha: "abcdef123456", language: "TypeScript", sizeKb: 10, fileCount: 5, hasTests: true, hasWorkflows: true } };
const simulation = (overrides: Partial<InvestigationSimulationState> = {}): InvestigationSimulationState => ({ stepIndex: 1, elapsedSeconds: 8, running: false, visibleEventIds: [], completed: false, updatedAt: "2026-01-01T00:00:00.000Z", ...overrides });

describe("investigation lifecycle and persistence", () => {
  let localStorage: MemoryStorage;
  beforeEach(() => { localStorage = new MemoryStorage(); vi.stubGlobal("window", { localStorage }); __resetRepositoryForTests(); });

  it("allows declared forward transitions and rejects regressions", () => {
    expect(canTransitionStatus("awaiting_claim_review", "investigating")).toBe(true);
    expect(canTransitionStatus("judging", "investigating")).toBe(false);
    expect(canTransitionStatus("completed", "investigating")).toBe(false);
  });
  it("creates collision-safe stable IDs", () => { const first = createInvestigation(input), second = createInvestigation(input); expect(first.id).not.toBe(second.id); expect(getInvestigation(first.id)?.id).toBe(first.id); });
  it("enforces five selected claims and known IDs", () => { const inv = createInvestigation(input); const six = inv.claims.map((claim, index) => ({ ...claim, selected: index < 6 })); expect(saveClaims(inv.id, six)?.claims.filter((claim) => claim.selected)).toHaveLength(inv.claims.filter((claim) => claim.selected).length); const foreign = inv.claims.map((claim, index) => index ? claim : { ...claim, id: "foreign" }); expect(saveClaims(inv.id, foreign)?.claims[0].id).toBe(inv.claims[0].id); });
  it("does not regress failed or later-stage records through simulation", () => { const inv = createInvestigation(input); transitionInvestigation(inv.id, "failed"); beginInvestigation(inv.id); saveSimulationState(inv.id, simulation()); expect(getInvestigation(inv.id)?.status).toBe("failed"); });
  it("keeps completion and its report idempotent", () => { const inv = createInvestigation(input); beginInvestigation(inv.id); const report = buildMockReport(getInvestigation(inv.id)!, 9); const done = simulation({ stepIndex: 6, completed: true }); const first = completeInvestigation(inv.id, report, done)!; const alternate = { ...report, investigationDate: "2099-01-01T00:00:00.000Z" }; const second = completeInvestigation(inv.id, alternate, done)!; expect(second.report).toEqual(first.report); expect(second.completedAt).toBe(first.completedAt); saveSimulationState(inv.id, simulation()); expect(getInvestigation(inv.id)?.status).toBe("completed"); });
  it("uses deterministic report identity and timestamps", () => { const inv = createInvestigation(input); const first = buildMockReport(inv, 3), second = buildMockReport(inv, 3); expect(second.id).toBe(first.id); expect(second.investigationDate).toBe(first.investigationDate); expect(second.judgments).toEqual(first.judgments); });
  it("handles invalid JSON and malformed records", () => { localStorage.setItem(__storageKeyForTests, "{"); expect(getInvestigation("missing")).toBeNull(); expect(getStorageHealth().status).toBe("malformed"); localStorage.setItem(__storageKeyForTests, JSON.stringify({ version: 1, investigations: { wrong: { id: "different" } } })); expect(getInvestigation("wrong")).toBeNull(); expect(getStorageHealth().status).toBe("malformed"); });
  it("handles a throwing localStorage property", () => { vi.stubGlobal("window", Object.defineProperty({}, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } })); expect(createInvestigation(input).id).toMatch(/^inv-/); expect(getStorageHealth().status).toBe("unavailable"); });
});

describe("simulation state machine", () => {
  it("advances in order and stops at completion", () => { let state = simulation({ stepIndex: 4, running: true }); state = advanceSimulation(state); expect(state.stepIndex).toBe(5); state = advanceSimulation(state); expect(state).toMatchObject({ stepIndex: 6, completed: true, running: false }); expect(advanceSimulation(state)).toBe(state); });
  it("pauses and resumes without losing progress", () => { const running = simulation({ stepIndex: 3, running: true }); const paused = pauseSimulation(running); expect(advanceSimulation(paused).stepIndex).toBe(3); expect(resumeSimulation(paused)).toMatchObject({ stepIndex: 3, running: true }); });
});

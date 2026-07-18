import { EXTRACTED_CLAIMS } from "./mock-data";
import { canTransitionStatus, isClaimReviewEditable } from "./investigation-lifecycle";
import type { Claim, Investigation, InvestigationSimulationState, InvestigationStatus, Report, RepositorySnapshot, SubmissionType } from "./types";
import { validateClaim as strictClaim, validateInvestigation as strictInvestigation, validateReportForInvestigation as strictReportForInvestigation, validateSimulation as strictSimulation } from "./investigation-validation";
export type TransitionResult = { investigation: Investigation | null; changed: boolean; allowed: boolean };

const STORAGE_KEY = "cernix.investigations.v1";
const VERSION = 1;
export const MAX_SELECTED_CLAIMS = 5;
export const MAX_SIMULATION_STEP = 6;
type Store = { version: number; investigations: Record<string, Investigation> };
export type StorageHealth = { status: "available"; message?: string } | { status: "unavailable" | "malformed"; message: string };
export type CreateInvestigationInput = { repositoryUrl: string; branch: string; submissionType: SubmissionType; description: string; focusQuestion?: string; repositoryMetadata: { commitSha: string; language: string; sizeKb: number; fileCount: number; hasTests: boolean; hasWorkflows: boolean } };

const emptyStore = (): Store => ({ version: VERSION, investigations: {} });
let fallbackIdCounter = 0;
let memoryStore = emptyStore();
let health: StorageHealth = { status: "available" };
let storageQuarantined = false;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function storage(): Storage | null { if (typeof window === "undefined") return null; try { return window.localStorage; } catch { return null; } }
function read(): Store {
  const target = storage(); if (!target) { health = { status: "unavailable", message: "Local storage is unavailable. Changes are kept only for this session." }; return memoryStore; }
  if (storageQuarantined) return memoryStore;
  try {
    const raw = target.getItem(STORAGE_KEY);
    if (!raw) { memoryStore = emptyStore(); storageQuarantined = false; health = { status: "available" }; return memoryStore; }
    const parsed: unknown = JSON.parse(raw);
    if (!object(parsed) || parsed.version !== VERSION || !object(parsed.investigations)) throw new Error();
    const investigations: Record<string, Investigation> = {};
    let rejected = 0;
    for (const [key, value] of Object.entries(parsed.investigations)) {
      if (strictInvestigation(value, key)) investigations[key] = value;
      else rejected += 1;
    }
    memoryStore = { version: VERSION, investigations };
    storageQuarantined = rejected > 0;
    health = rejected > 0
      ? { status: "malformed", message: `${rejected} saved investigation record${rejected === 1 ? "" : "s"} failed validation and ${rejected === 1 ? "has" : "have"} been quarantined. Valid records remain available; storage will not be overwritten this session.` }
      : { status: "available" };
    return memoryStore;
  } catch {
    memoryStore = emptyStore();
    storageQuarantined = true;
    health = { status: "malformed", message: "Saved investigation data failed validation and has been quarantined. Storage will not be overwritten this session." };
    return memoryStore;
  }
}
function write(store: Store) { memoryStore = store; const target = storage(); if (!target) { health = { status: "unavailable", message: "Local storage is unavailable. Changes are kept only for this session." }; return; } if (storageQuarantined) return; try { target.setItem(STORAGE_KEY, JSON.stringify(store)); health = { status: "available" }; } catch { health = { status: "unavailable", message: "Local storage could not save this investigation. Changes are kept only for this session." }; } }
function update(id: string, fn: (current: Investigation) => Investigation) { const store = read(), current = store.investigations[id]; if (!current) return null; const next = fn(current); if (!strictInvestigation(next, id)) return current; store.investigations[id] = next; write(store); return next; }
function randomToken() { try { return crypto.randomUUID(); } catch { try { const bytes = new Uint8Array(16); crypto.getRandomValues(bytes); return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); } catch { fallbackIdCounter += 1; return `${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`; } } }

export const getStorageHealth = () => health;
export const listInvestigations = () => Object.values(read().investigations).sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
export const getInvestigation = (id: string) => read().investigations[id] ?? null;
export function createInvestigation(input: CreateInvestigationInput): Investigation { const urlParts = new URL(input.repositoryUrl).pathname.split("/").filter(Boolean), owner = urlParts[0] ?? "unknown", repo = (urlParts[1] ?? "repository").replace(/\.git$/, ""), slug = `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32), id = `inv-${slug}-${randomToken()}`, now = new Date().toISOString(), branch = input.branch.trim() || "main"; const repositorySnapshot: RepositorySnapshot = { owner, repo, branch, commitSha: input.repositoryMetadata.commitSha, primaryLanguage: input.repositoryMetadata.language, languages: [input.repositoryMetadata.language], sizeKb: input.repositoryMetadata.sizeKb, fileCount: input.repositoryMetadata.fileCount, hasTests: input.repositoryMetadata.hasTests, hasWorkflows: input.repositoryMetadata.hasWorkflows, snapshotAt: now }; const claims = EXTRACTED_CLAIMS.map((claim, index) => ({ ...claim, id: `${id}-clm-${String(index + 1).padStart(3, "0")}`, investigationId: id, selected: index < MAX_SELECTED_CLAIMS ? claim.selected : false, status: "queued" as const, verdict: undefined, confidence: undefined, evidenceCount: 0, openLimitations: 0 })); const investigation: Investigation = { id, project: { id: `proj-${id}`, name: repo, repositoryUrl: input.repositoryUrl, owner, repo, description: input.description }, repositorySnapshot, submission: { id: `sub-${id}`, projectId: `proj-${id}`, type: input.submissionType, content: input.description, focusQuestion: input.focusQuestion?.trim() || undefined, submittedAt: now }, status: "awaiting_claim_review", claims, agentRuns: [], workflowStages: [], startedAt: now, requiresHumanReview: false }; const store = read(); store.investigations[id] = investigation; write(store); return investigation; }
export function requestTransition(id: string, target: InvestigationStatus): TransitionResult { const current = getInvestigation(id); if (!current) return { investigation: null, changed: false, allowed: false }; const allowed = canTransitionStatus(current.status, target); if (!allowed || current.status === target) return { investigation: current, changed: false, allowed }; const investigation = update(id, (value) => ({ ...value, status: target })); return { investigation, changed: investigation?.status === target, allowed: true }; }
export function transitionInvestigation(id: string, target: InvestigationStatus) { return requestTransition(id, target).investigation; }
export function saveClaims(id: string, claims: Claim[]) { return update(id, (current) => { const ids = new Set(current.claims.map((claim) => claim.id)); const valid = isClaimReviewEditable(current.status) && claims.length === current.claims.length && new Set(claims.map((claim) => claim.id)).size === claims.length && claims.every((claim) => claim.investigationId === id && ids.has(claim.id) && strictClaim(claim, id)) && claims.filter((claim) => claim.selected).length <= MAX_SELECTED_CLAIMS; return valid ? { ...current, claims, status: current.status === "draft" || current.status === "extracting_claims" ? "awaiting_claim_review" : current.status } : current; }); }
export const saveSelectedClaims = saveClaims;
export function beginInvestigation(id: string) { const current = getInvestigation(id); return !current || current.claims.every((claim) => !claim.selected) ? current : transitionInvestigation(id, "investigating"); }
export function saveSimulationState(id: string, state: InvestigationSimulationState) { return update(id, (current) => current.status === "investigating" && strictSimulation(state) && !state.completed ? { ...current, simulationState: state } : current); }
export function completeInvestigation(id: string, report: Report, state: InvestigationSimulationState) { return update(id, (current) => { if (current.report || !canTransitionStatus(current.status, "completed") || !strictReportForInvestigation(report, current) || !strictSimulation(state) || !state.completed) return current; const completedAt = current.completedAt ?? new Date().toISOString(); const stableReport = { ...report, investigationDate: completedAt, judgments: Object.fromEntries(Object.entries(report.judgments).map(([claimId, judgment]) => [claimId, { ...judgment, issuedAt: completedAt }])) }; const reportClaims = new Map(stableReport.claims.map((claim) => [claim.id, claim])); const claims = current.claims.map((claim) => reportClaims.get(claim.id) ?? claim); return { ...current, claims, status: "completed", completedAt, durationSeconds: stableReport.durationSeconds, requiresHumanReview: stableReport.claims.some((claim) => claim.requiresHumanReview), report: stableReport, simulationState: { ...state, running: false, completed: true, updatedAt: completedAt } }; }); }
export const getReport = (id: string) => getInvestigation(id)?.report ?? null;
export function __resetRepositoryForTests() { memoryStore = emptyStore(); storageQuarantined = false; health = { status: "available" }; }
export const __storageKeyForTests = STORAGE_KEY;

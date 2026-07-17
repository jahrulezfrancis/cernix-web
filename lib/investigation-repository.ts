import { EXTRACTED_CLAIMS } from "./mock-data";
import type {
  Claim,
  Investigation,
  InvestigationSimulationState,
  Report,
  RepositorySnapshot,
  SubmissionType,
} from "./types";

const STORAGE_KEY = "cernix.investigations.v1";

type Store = {
  investigations: Record<string, Investigation>;
};

export type StorageHealth =
  | { status: "available"; message?: string }
  | { status: "unavailable"; message: string }
  | { status: "malformed"; message: string };

export type CreateInvestigationInput = {
  repositoryUrl: string;
  branch: string;
  submissionType: SubmissionType;
  description: string;
  focusQuestion?: string;
  repositoryMetadata: {
    commitSha: string;
    language: string;
    sizeKb: number;
    fileCount: number;
    hasTests: boolean;
    hasWorkflows: boolean;
  };
};

let memoryStore: Store = { investigations: {} };
let lastStorageHealth: StorageHealth = { status: "available" };

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function emptyStore(): Store {
  return { investigations: {} };
}

function isInvestigation(value: unknown): value is Investigation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Investigation>;
  return (
    typeof candidate.id === "string" &&
    !!candidate.project &&
    !!candidate.repositorySnapshot &&
    !!candidate.submission &&
    Array.isArray(candidate.claims)
  );
}

function normalizeStore(value: unknown): Store {
  if (!value || typeof value !== "object") return emptyStore();
  const raw = value as { investigations?: unknown };
  if (!raw.investigations || typeof raw.investigations !== "object") return emptyStore();

  const investigations: Record<string, Investigation> = {};
  for (const [id, investigation] of Object.entries(raw.investigations)) {
    if (isInvestigation(investigation)) {
      investigations[id] = investigation;
    }
  }
  return { investigations };
}

function readStore(): Store {
  if (!canUseStorage()) {
    lastStorageHealth = {
      status: "unavailable",
      message: "Local storage is unavailable. Changes are kept only for this session.",
    };
    return memoryStore;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      lastStorageHealth = { status: "available" };
      return emptyStore();
    }
    const parsed = JSON.parse(raw);
    const store = normalizeStore(parsed);
    memoryStore = store;
    lastStorageHealth = { status: "available" };
    return store;
  } catch {
    lastStorageHealth = {
      status: "malformed",
      message: "Saved investigation data was malformed and has been ignored for this session.",
    };
    return emptyStore();
  }
}

function writeStore(store: Store) {
  memoryStore = store;
  if (!canUseStorage()) {
    lastStorageHealth = {
      status: "unavailable",
      message: "Local storage is unavailable. Changes are kept only for this session.",
    };
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    lastStorageHealth = { status: "available" };
  } catch {
    lastStorageHealth = {
      status: "unavailable",
      message: "Local storage could not save this investigation.",
    };
  }
}

function parseRepositoryUrl(repositoryUrl: string) {
  const match = repositoryUrl.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/);
  const owner = match?.[1] ?? "unknown";
  const repo = (match?.[2] ?? "repository").replace(/\.git$/, "");
  return { owner, repo };
}

function createInvestigationId(owner: string, repo: string) {
  const slug = `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `inv-${slug}-${Date.now().toString(36)}`;
}

function cloneExtractedClaims(investigationId: string): Claim[] {
  return EXTRACTED_CLAIMS.map((claim, index) => ({
    ...claim,
    id: `${investigationId}-clm-${String(index + 1).padStart(3, "0")}`,
    investigationId,
    selected: index < 5 ? claim.selected : false,
    status: "queued",
    verdict: undefined,
    confidence: undefined,
    evidenceCount: 0,
    openLimitations: 0,
  }));
}

export function getStorageHealth(): StorageHealth {
  return lastStorageHealth;
}

export function listInvestigations(): Investigation[] {
  return Object.values(readStore().investigations);
}

export function getInvestigation(id: string): Investigation | null {
  return readStore().investigations[id] ?? null;
}

export function createInvestigation(input: CreateInvestigationInput): Investigation {
  const { owner, repo } = parseRepositoryUrl(input.repositoryUrl);
  const now = new Date().toISOString();
  const id = createInvestigationId(owner, repo);
  const branch = input.branch.trim() || "main";

  const repositorySnapshot: RepositorySnapshot = {
    owner,
    repo,
    branch,
    commitSha: input.repositoryMetadata.commitSha,
    primaryLanguage: input.repositoryMetadata.language,
    languages: [input.repositoryMetadata.language],
    sizeKb: input.repositoryMetadata.sizeKb,
    fileCount: input.repositoryMetadata.fileCount,
    hasTests: input.repositoryMetadata.hasTests,
    hasWorkflows: input.repositoryMetadata.hasWorkflows,
    snapshotAt: now,
  };

  const investigation: Investigation = {
    id,
    project: {
      id: `proj-${id}`,
      name: repo,
      repositoryUrl: input.repositoryUrl,
      owner,
      repo,
      description: input.description,
    },
    repositorySnapshot,
    submission: {
      id: `sub-${id}`,
      projectId: `proj-${id}`,
      type: input.submissionType,
      content: input.description,
      focusQuestion: input.focusQuestion?.trim() || undefined,
      submittedAt: now,
    },
    status: "awaiting_claim_review",
    claims: cloneExtractedClaims(id),
    agentRuns: [],
    workflowStages: [],
    startedAt: now,
    requiresHumanReview: false,
  };

  const store = readStore();
  store.investigations[id] = investigation;
  writeStore(store);
  return investigation;
}

export function updateInvestigation(
  id: string,
  updater: (investigation: Investigation) => Investigation
): Investigation | null {
  const store = readStore();
  const current = store.investigations[id];
  if (!current) return null;
  const next = updater(current);
  store.investigations[id] = next;
  writeStore(store);
  return next;
}

export function saveClaims(id: string, claims: Claim[]) {
  return updateInvestigation(id, (investigation) => ({
    ...investigation,
    claims,
    status:
      investigation.status === "draft" || investigation.status === "extracting_claims"
        ? "awaiting_claim_review"
        : investigation.status,
  }));
}

export function saveSelectedClaims(id: string, claims: Claim[]) {
  return saveClaims(id, claims);
}

export function beginInvestigation(id: string) {
  return updateInvestigation(id, (investigation) => ({
    ...investigation,
    status:
      investigation.status === "awaiting_claim_review"
        ? "investigating"
        : investigation.status,
  }));
}

export function saveSimulationState(
  id: string,
  simulationState: InvestigationSimulationState
) {
  return updateInvestigation(id, (investigation) => ({
    ...investigation,
    simulationState,
    status: simulationState.completed ? investigation.status : "investigating",
  }));
}

export function completeInvestigation(
  id: string,
  report: Report,
  simulationState: InvestigationSimulationState
) {
  return updateInvestigation(id, (investigation) => ({
    ...investigation,
    claims: report.claims,
    status: "completed",
    completedAt: new Date().toISOString(),
    durationSeconds: report.durationSeconds,
    requiresHumanReview: report.claims.some((claim) => claim.requiresHumanReview),
    report,
    simulationState: {
      ...simulationState,
      completed: true,
      running: false,
      updatedAt: new Date().toISOString(),
    },
  }));
}

export function getReport(id: string): Report | null {
  return getInvestigation(id)?.report ?? null;
}

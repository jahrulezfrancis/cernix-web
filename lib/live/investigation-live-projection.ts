import type {
  BackendLifecycleStatus,
  InvestigationEventResponse,
  InvestigationResponse,
} from "@/lib/contracts/investigation-api";

export type WorkflowStageStatus = "pending" | "active" | "completed" | "failed" | "skipped";

export interface LiveWorkflowStage {
  id: string;
  label: string;
  status: WorkflowStageStatus;
}

export interface LiveAgentCard {
  id: string;
  label: string;
  status: "idle" | "running" | "completed" | "failed";
  summary: string;
  stats: ReadonlyArray<{ label: string; value: string | number }>;
}

export type LiveEventTone = "neutral" | "success" | "warning" | "error" | "active";

export interface LiveEventView {
  sequence: number;
  type: string;
  stage: BackendLifecycleStatus;
  createdAt: string;
  title: string;
  detail: string;
  tone: LiveEventTone;
  rawPayload: unknown;
}

export interface LiveProjection {
  workflowStages: LiveWorkflowStage[];
  agents: LiveAgentCard[];
  events: LiveEventView[];
  progressLabel: string;
  progressPercent: number;
  claimStatusLabel: string;
}

const CORE_STAGE_ORDER: ReadonlyArray<{ id: BackendLifecycleStatus; label: string }> = [
  { id: "snapshotting", label: "Repository snapshot" },
  { id: "planning", label: "Investigation planning" },
  { id: "investigating", label: "Evidence gathering" },
  { id: "challenging", label: "Skeptic challenge" },
  { id: "judging", label: "Final judgment" },
];

const REINVESTIGATION_STAGE = {
  id: "reinvestigating" as const,
  label: "Targeted reinvestigation",
};

const TERMINAL_SUCCESS = new Set<BackendLifecycleStatus>(["completed", "completed_with_limitations"]);
const ACTIVE_PIPELINE = new Set<BackendLifecycleStatus>([
  "snapshotting",
  "planning",
  "investigating",
  "challenging",
  "reinvestigating",
  "judging",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function shortSha(value: unknown): string {
  return typeof value === "string" && value.length >= 7 ? value.slice(0, 7) : "unknown";
}

function formatJobKind(value: unknown): string {
  if (typeof value !== "string") return "background job";
  return value.replaceAll("_", " ");
}

function hasEvent(events: ReadonlyArray<InvestigationEventResponse>, type: string): boolean {
  return events.some((event) => event.type === type);
}

function countEvents(events: ReadonlyArray<InvestigationEventResponse>, type: string): number {
  return events.filter((event) => event.type === type).length;
}

function visitedReinvestigation(
  status: BackendLifecycleStatus,
  events: ReadonlyArray<InvestigationEventResponse>
): boolean {
  return status === "reinvestigating" || hasEvent(events, "reinvestigation_started");
}

function stageIndex(stages: ReadonlyArray<{ id: string }>, id: string): number {
  return stages.findIndex((stage) => stage.id === id);
}

function resolveWorkflowStages(
  status: BackendLifecycleStatus,
  events: ReadonlyArray<InvestigationEventResponse>
): LiveWorkflowStage[] {
  const includeReinvestigation = visitedReinvestigation(status, events);
  const ordered = includeReinvestigation
    ? [
        CORE_STAGE_ORDER[0],
        CORE_STAGE_ORDER[1],
        CORE_STAGE_ORDER[2],
        CORE_STAGE_ORDER[3],
        REINVESTIGATION_STAGE,
        CORE_STAGE_ORDER[4],
      ]
    : [...CORE_STAGE_ORDER];

  if (TERMINAL_SUCCESS.has(status)) {
    return ordered.map((stage) => ({ ...stage, status: "completed" as const }));
  }

  if (status === "failed") {
    const failedAt = events
      .filter((event) => event.type === "lifecycle_transitioned")
      .map((event) => asRecord(event.publicPayload))
      .findLast((payload) => payload?.to === "failed");
    const failedFrom =
      typeof failedAt?.from === "string" ? (failedAt.from as BackendLifecycleStatus) : status;

    return ordered.map((stage) => {
      const index = stageIndex(ordered, stage.id);
      const failedIndex = stageIndex(ordered, failedFrom);
      if (index < failedIndex) return { ...stage, status: "completed" as const };
      if (index === failedIndex) return { ...stage, status: "failed" as const };
      return { ...stage, status: "pending" as const };
    });
  }

  if (!ACTIVE_PIPELINE.has(status)) {
    return ordered.map((stage) => ({ ...stage, status: "pending" as const }));
  }

  const activeIndex = stageIndex(ordered, status);
  return ordered.map((stage, index) => ({
    ...stage,
    status:
      index < activeIndex
        ? ("completed" as const)
        : index === activeIndex
          ? ("active" as const)
          : ("pending" as const),
  }));
}

function agentStatus(
  phase: BackendLifecycleStatus | BackendLifecycleStatus[],
  current: BackendLifecycleStatus,
  completed: boolean,
  failedPhase?: BackendLifecycleStatus
): LiveAgentCard["status"] {
  const phases = Array.isArray(phase) ? phase : [phase];
  if (current === "failed" && failedPhase && phases.includes(failedPhase)) return "failed";
  if (completed) return "completed";
  if (phases.includes(current)) return "running";
  const currentIndex = stageIndex(
    [...CORE_STAGE_ORDER, REINVESTIGATION_STAGE],
    current === "reinvestigating" ? "reinvestigating" : current
  );
  const phaseIndex = Math.min(...phases.map((item) => stageIndex(CORE_STAGE_ORDER, item)).filter((index) => index >= 0));
  if (currentIndex > phaseIndex && phaseIndex >= 0) return "completed";
  return "idle";
}

function resolveAgents(
  status: BackendLifecycleStatus,
  events: ReadonlyArray<InvestigationEventResponse>
): LiveAgentCard[] {
  const snapshotEvent = events.find((event) => event.type === "repository_snapshot_persisted");
  const planEvent = events.find((event) => event.type === "investigation_plan_persisted");
  const skepticEvent = events.find((event) => event.type === "skeptic_analysis_persisted");
  const reportEvent = events.find((event) => event.type === "investigation_report_persisted");
  const evidenceTasks = countEvents(events, "evidence_task_completed");
  const reinvestigationCycles = countEvents(events, "reinvestigation_started");

  const snapshotPayload = snapshotEvent ? asRecord(snapshotEvent.publicPayload) : null;
  const planPayload = planEvent ? asRecord(planEvent.publicPayload) : null;
  const skepticPayload = skepticEvent ? asRecord(skepticEvent.publicPayload) : null;
  const reportPayload = reportEvent ? asRecord(reportEvent.publicPayload) : null;

  const failedTransition = events
    .filter((event) => event.type === "lifecycle_transitioned")
    .map((event) => asRecord(event.publicPayload))
    .findLast((payload) => payload?.to === "failed");
  const failedFrom =
    typeof failedTransition?.from === "string"
      ? (failedTransition.from as BackendLifecycleStatus)
      : undefined;

  const taskCount = typeof planPayload?.taskCount === "number" ? planPayload.taskCount : null;

  return [
    {
      id: "snapshot",
      label: "Repository Snapshot",
      status: agentStatus("snapshotting", status, !!snapshotEvent, failedFrom),
      summary: snapshotPayload
        ? `Pinned commit ${shortSha(snapshotPayload.commitSha)} with ${String(snapshotPayload.admittedFileCount ?? 0)} admitted files.`
        : "Resolving repository tree and admitting bounded snapshot files.",
      stats: snapshotPayload
        ? [
            { label: "Files", value: Number(snapshotPayload.admittedFileCount ?? 0) },
            { label: "Entries", value: Number(snapshotPayload.inspectedEntryCount ?? 0) },
          ]
        : [],
    },
    {
      id: "planner",
      label: "Investigation Planner",
      status: agentStatus("planning", status, !!planEvent, failedFrom),
      summary: planPayload
        ? `Created ${String(planPayload.taskCount ?? 0)} tasks across ${String(planPayload.obligationCount ?? 0)} obligations.`
        : "Decomposing the approved claim into verification obligations.",
      stats: planPayload
        ? [
            { label: "Tasks", value: Number(planPayload.taskCount ?? 0) },
            { label: "Obligations", value: Number(planPayload.obligationCount ?? 0) },
          ]
        : [],
    },
    {
      id: "investigator",
      label: "Repository Investigator",
      status: agentStatus(["investigating", "reinvestigating"], status, evidenceTasks > 0 && !["investigating", "reinvestigating"].includes(status), failedFrom),
      summary:
        evidenceTasks > 0
          ? `Completed ${evidenceTasks}${taskCount ? ` of ${taskCount}` : ""} evidence tasks.`
          : "Inspecting admitted snapshot content for evidence candidates and gaps.",
      stats: [
        { label: "Tasks done", value: evidenceTasks },
        ...(taskCount ? [{ label: "Planned", value: taskCount }] : []),
        ...(reinvestigationCycles ? [{ label: "Reinvestigation cycles", value: reinvestigationCycles }] : []),
      ],
    },
    {
      id: "skeptic",
      label: "Skeptic Agent",
      status: agentStatus("challenging", status, !!skepticEvent, failedFrom),
      summary: skepticPayload
        ? `Outcome: ${String(skepticPayload.outcome ?? "pending").replaceAll("_", " ")} with ${String(skepticPayload.challengeCount ?? 0)} challenges.`
        : "Challenging provisional evidence before judgment.",
      stats: skepticPayload ? [{ label: "Challenges", value: Number(skepticPayload.challengeCount ?? 0) }] : [],
    },
    {
      id: "judge",
      label: "Evidence Judge",
      status: agentStatus("judging", status, !!reportEvent, failedFrom),
      summary: reportPayload
        ? `Report persisted with ${String(reportPayload.judgmentCount ?? 0)} judgments.`
        : "Issuing bounded verdicts with limitations and maintainer actions.",
      stats: reportPayload ? [{ label: "Judgments", value: Number(reportPayload.judgmentCount ?? 0) }] : [],
    },
  ];
}

function eventTone(type: string, payload: Record<string, unknown> | null): LiveEventTone {
  if (type === "lifecycle_transitioned" && payload?.to === "failed") return "error";
  if (type === "investigation_report_persisted") return "success";
  if (type === "reinvestigation_started") return "warning";
  if (type === "skeptic_analysis_persisted" && payload?.outcome === "reinvestigation_required") return "warning";
  if (type === "investigation_started") return "active";
  return "neutral";
}

export function describeInvestigationEvent(event: InvestigationEventResponse): Pick<LiveEventView, "title" | "detail" | "tone"> {
  const payload = asRecord(event.publicPayload);

  switch (event.type) {
    case "investigation_created":
      return {
        title: "Investigation created",
        detail: "A new investigation was created with one claim awaiting review.",
        tone: "neutral",
      };
    case "claim_approved":
      return {
        title: "Claim approved",
        detail: `${String(payload?.qualifierCount ?? 0)} preserved qualifiers recorded.`,
        tone: "success",
      };
    case "claim_edited":
      return {
        title: "Claim edited",
        detail: `${String(payload?.qualifierCount ?? 0)} preserved qualifiers recorded.`,
        tone: "neutral",
      };
    case "investigation_started":
      return {
        title: "Worker job started",
        detail: `Started ${formatJobKind(payload?.jobKind)}.`,
        tone: "active",
      };
    case "repository_snapshot_persisted":
      return {
        title: "Repository snapshot persisted",
        detail: `Commit ${shortSha(payload?.commitSha)} · ${String(payload?.admittedFileCount ?? 0)} admitted files · ${String(payload?.inspectedEntryCount ?? 0)} entries inspected.`,
        tone: "success",
      };
    case "investigation_plan_persisted":
      return {
        title: "Investigation plan persisted",
        detail: `${String(payload?.taskCount ?? 0)} tasks across ${String(payload?.obligationCount ?? 0)} obligations.`,
        tone: "success",
      };
    case "evidence_task_completed":
      return {
        title: "Evidence task completed",
        detail: `Task ${String(payload?.taskKey ?? "unknown")} · ${String(payload?.candidateCount ?? 0)} candidates · ${String(payload?.gapCount ?? 0)} gaps · ${String(payload?.counterCount ?? 0)} counterevidence items.`,
        tone: "neutral",
      };
    case "skeptic_analysis_persisted":
      return {
        title: "Skeptic analysis persisted",
        detail: `${String(payload?.outcome ?? "pending").replaceAll("_", " ")} · ${String(payload?.challengeCount ?? 0)} challenges raised.`,
        tone: payload?.outcome === "reinvestigation_required" ? "warning" : "success",
      };
    case "reinvestigation_started":
      return {
        title: "Reinvestigation started",
        detail: `Cycle ${String(payload?.cycle ?? 1)} · ${Array.isArray(payload?.taskKeys) ? payload.taskKeys.length : 0} tasks queued.`,
        tone: "warning",
      };
    case "investigation_report_persisted":
      return {
        title: "Investigation report persisted",
        detail: `${String(payload?.judgmentCount ?? 0)} judgments · disposition ${String(payload?.completionDisposition ?? "completed").replaceAll("_", " ")}.`,
        tone: "success",
      };
    case "lifecycle_transitioned":
      return {
        title: "Lifecycle transition",
        detail: `${String(payload?.from ?? "unknown").replaceAll("_", " ")} → ${String(payload?.to ?? "unknown").replaceAll("_", " ")}.`,
        tone: eventTone(event.type, payload),
      };
    default:
      return {
        title: event.type.replaceAll("_", " "),
        detail: "Persisted backend event.",
        tone: "neutral",
      };
  }
}

function toEventView(event: InvestigationEventResponse): LiveEventView {
  const described = describeInvestigationEvent(event);
  return {
    sequence: event.sequence,
    type: event.type,
    stage: event.stage,
    createdAt: event.createdAt,
    rawPayload: event.publicPayload,
    ...described,
  };
}

function claimStatusLabel(status: BackendLifecycleStatus): string {
  switch (status) {
    case "snapshotting":
    case "planning":
      return "Planning";
    case "investigating":
      return "Investigating";
    case "challenging":
      return "Challenged";
    case "reinvestigating":
      return "Reinvestigating";
    case "judging":
      return "Judging";
    case "completed":
    case "completed_with_limitations":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return "Queued";
  }
}

function progressFromStages(stages: ReadonlyArray<LiveWorkflowStage>): { label: string; percent: number } {
  const meaningful = stages.filter((stage) => stage.status !== "skipped");
  const completed = meaningful.filter((stage) => stage.status === "completed").length;
  const active = meaningful.some((stage) => stage.status === "active");
  const total = meaningful.length;
  const percent = total === 0 ? 0 : Math.round(((completed + (active ? 0.5 : 0)) / total) * 100);

  const activeStage = meaningful.find((stage) => stage.status === "active");
  if (activeStage) return { label: activeStage.label, percent };
  if (completed === total && total > 0) return { label: "Investigation complete", percent: 100 };
  if (meaningful.some((stage) => stage.status === "failed")) return { label: "Investigation failed", percent };
  return { label: "Awaiting progress", percent };
}

export function projectInvestigationLiveView(
  investigation: InvestigationResponse,
  events: ReadonlyArray<InvestigationEventResponse>
): LiveProjection {
  const workflowStages = resolveWorkflowStages(investigation.status, events);
  const { label: progressLabel, percent: progressPercent } = progressFromStages(workflowStages);

  return {
    workflowStages,
    agents: resolveAgents(investigation.status, events),
    events: events.map(toEventView),
    progressLabel,
    progressPercent,
    claimStatusLabel: claimStatusLabel(investigation.status),
  };
}

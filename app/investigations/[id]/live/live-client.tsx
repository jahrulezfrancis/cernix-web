"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { cn, formatDuration } from "@/lib/utils";
import {
  completeInvestigation,
  getInvestigation,
  getStorageHealth,
  saveSimulationState,
} from "@/lib/investigation-repository";
import { buildMockReport } from "@/lib/mock-report-generator";
import type {
  Claim,
  ClaimStatus,
  Investigation,
  InvestigationSimulationState,
  WorkflowStageStatus,
} from "@/lib/types";
import {
  Play,
  Pause,
  SkipForward,
  CheckCircle,
  Circle,
  Loader2,
  XCircle,
  FileText,
  ArrowRight,
  AlertTriangle,
  ShieldAlert,
  Gavel,
  Search,
  Truck,
} from "lucide-react";

interface SimWorkflowStage {
  id: string;
  label: string;
  status: WorkflowStageStatus;
}

interface SimClaim {
  id: string;
  statement: string;
  status: ClaimStatus;
}

interface SimAgentRun {
  id: string;
  role: string;
  icon: React.ElementType;
  label: string;
  task: string;
  filesInspected: number;
  evidenceCollected: number;
  proofChecked: number;
  status: "idle" | "running" | "completed" | "failed";
}

interface SimEvent {
  id: string;
  type:
    | "evidence_validated"
    | "proof_obligation_satisfied"
    | "contradiction_discovered"
    | "evidence_rejected"
    | "reinvestigation_requested"
    | "claim_sent_to_judgment"
    | "human_input_required";
  text: string;
  claimId?: string;
  timestamp: number;
}

type SimStep = {
  stages: SimWorkflowStage[];
  claims: SimClaim[];
  agents: SimAgentRun[];
  progress: number;
  stage: string;
};

const EVENT_TYPE_CONFIG = {
  evidence_validated: { label: "Evidence validated", color: "text-[#4FBF9A]", dot: "bg-[#4FBF9A]" },
  proof_obligation_satisfied: { label: "Proof obligation satisfied", color: "text-[#FF6B1A]", dot: "bg-[#FF6B1A]" },
  contradiction_discovered: { label: "Contradiction discovered", color: "text-[#F2796B]", dot: "bg-[#F2796B]" },
  evidence_rejected: { label: "Evidence rejected", color: "text-[#F2796B]", dot: "bg-[#F2796B]" },
  reinvestigation_requested: { label: "Reinvestigation requested", color: "text-[#FFC94D]", dot: "bg-[#FFC94D]" },
  claim_sent_to_judgment: { label: "Sent to judgment", color: "text-[#FF8540]", dot: "bg-[#FF8540]" },
  human_input_required: { label: "Human input required", color: "text-[#FFC94D]", dot: "bg-[#FFC94D] animate-pulse" },
};

const CLAIM_STATUS_CONFIG: Record<ClaimStatus, { label: string; color: string }> = {
  queued: { label: "Queued", color: "text-[#4F7590]" },
  planning: { label: "Planning", color: "text-[#86ADC2]" },
  investigating: { label: "Investigating", color: "text-[#FF6B1A]" },
  challenged: { label: "Challenged", color: "text-[#FFC94D]" },
  reinvestigating: { label: "Reinvestigating", color: "text-[#FF8540]" },
  judging: { label: "Judging", color: "text-[#FF6B1A]" },
  completed: { label: "Completed", color: "text-[#4FBF9A]" },
  failed: { label: "Failed", color: "text-[#F2796B]" },
};

function baseStages(): SimWorkflowStage[] {
  return [
    { id: "s1", label: "Repository indexed", status: "completed" },
    { id: "s2", label: "Claims approved", status: "completed" },
    { id: "s3", label: "Investigation plans created", status: "active" },
    { id: "s4", label: "Specialist investigations", status: "pending" },
    { id: "s5", label: "Evidence challenges", status: "pending" },
    { id: "s6", label: "Targeted reinvestigation", status: "pending" },
    { id: "s7", label: "Final judgments", status: "pending" },
  ];
}

function statusStages(activeId: string, completedIds: string[] = []) {
  return baseStages().map((stage) =>
    completedIds.includes(stage.id)
      ? { ...stage, status: "completed" as WorkflowStageStatus }
      : stage.id === activeId
      ? { ...stage, status: "active" as WorkflowStageStatus }
      : stage
  );
}

function makeInitialClaims(claims: Claim[]): SimClaim[] {
  return claims.map((claim, index) => ({
    id: claim.id,
    statement: claim.normalizedInterpretation || claim.originalStatement,
    status: index === 0 ? "planning" : "queued",
  }));
}

function updateClaims(claims: SimClaim[], activeIndexes: number[], status: ClaimStatus) {
  return claims.map((claim, index) =>
    activeIndexes.includes(index) ? { ...claim, status } : claim
  );
}

function buildAgents(selectedClaims: Claim[], step: number): SimAgentRun[] {
  const firstClaim = selectedClaims[0]?.normalizedInterpretation ?? "selected claim";
  return [
    {
      id: "a1",
      role: "repository_investigator",
      icon: Search,
      label: "Repository Investigator",
      task: `Tracing repository evidence for ${firstClaim}`,
      filesInspected: step >= 1 ? 12 + step * 5 : 0,
      evidenceCollected: step >= 1 ? Math.min(step + 1, selectedClaims.length + 1) : 0,
      proofChecked: step >= 1 ? Math.min(step, selectedClaims.length) : 0,
      status: step === 0 ? "idle" : step >= 4 ? "completed" : "running",
    },
    {
      id: "a2",
      role: "delivery_investigator",
      icon: Truck,
      label: "Delivery Investigator",
      task: "Inspecting CI, tests, and delivery evidence for selected claims.",
      filesInspected: step >= 2 ? 10 + step * 3 : 0,
      evidenceCollected: step >= 2 ? Math.min(step, selectedClaims.length) : 0,
      proofChecked: step >= 2 ? Math.min(step - 1, selectedClaims.length) : 0,
      status: step < 2 ? "idle" : step >= 4 ? "completed" : "running",
    },
    {
      id: "a3",
      role: "skeptic_agent",
      icon: ShieldAlert,
      label: "Skeptic Agent",
      task: "Challenging weak conclusions before judgment.",
      filesInspected: step >= 3 ? 6 + step : 0,
      evidenceCollected: step >= 3 ? 1 : 0,
      proofChecked: step >= 3 ? Math.min(2, selectedClaims.length) : 0,
      status: step < 3 ? "idle" : step >= 5 ? "completed" : "running",
    },
    {
      id: "a4",
      role: "evidence_judge",
      icon: Gavel,
      label: "Evidence Judge",
      task: "Issuing final verdicts for selected claims.",
      filesInspected: 0,
      evidenceCollected: 0,
      proofChecked: step >= 5 ? selectedClaims.length : 0,
      status: step < 5 ? "idle" : step >= 6 ? "completed" : "running",
    },
  ];
}

function buildEvents(claims: Claim[]): SimEvent[] {
  return claims.flatMap((claim, index) => {
    const base = index * 8;
    return [
      {
        id: `evt-${claim.id}-evidence`,
        type: "evidence_validated" as const,
        text: `Evidence validated for: ${claim.normalizedInterpretation}`,
        claimId: claim.id,
        timestamp: 4 + base,
      },
      {
        id: `evt-${claim.id}-judgment`,
        type: index % 3 === 1 ? "reinvestigation_requested" as const : "claim_sent_to_judgment" as const,
        text:
          index % 3 === 1
            ? `Reinvestigation requested for: ${claim.normalizedInterpretation}`
            : `Claim sent to judgment: ${claim.normalizedInterpretation}`,
        claimId: claim.id,
        timestamp: 8 + base,
      },
    ];
  });
}

function buildSteps(selectedClaims: Claim[]): SimStep[] {
  const initialClaims = makeInitialClaims(selectedClaims);
  const firstTwo = selectedClaims.length > 1 ? [0, 1] : [0];
  return [
    {
      stages: baseStages(),
      claims: initialClaims,
      agents: buildAgents(selectedClaims, 0),
      progress: 8,
      stage: "Creating investigation plans",
    },
    {
      stages: statusStages("s4", ["s3"]),
      claims: updateClaims(initialClaims, [0], "investigating"),
      agents: buildAgents(selectedClaims, 1),
      progress: 22,
      stage: "Repository Investigator tracing selected claims",
    },
    {
      stages: statusStages("s4", ["s3"]),
      claims: updateClaims(initialClaims, firstTwo, "investigating"),
      agents: buildAgents(selectedClaims, 2),
      progress: 38,
      stage: "Delivery Investigator inspecting tests and CI",
    },
    {
      stages: statusStages("s5", ["s3", "s4"]),
      claims: initialClaims.map((claim, index) => ({
        ...claim,
        status: index < selectedClaims.length ? "challenged" : claim.status,
      })),
      agents: buildAgents(selectedClaims, 3),
      progress: 55,
      stage: "Skeptic Agent challenging weak evidence",
    },
    {
      stages: statusStages("s6", ["s3", "s4", "s5"]),
      claims: initialClaims.map((claim, index) => ({
        ...claim,
        status: index % 2 === 0 ? "judging" : "reinvestigating",
      })),
      agents: buildAgents(selectedClaims, 4),
      progress: 72,
      stage: "Targeted reinvestigation of challenged evidence",
    },
    {
      stages: statusStages("s7", ["s3", "s4", "s5", "s6"]),
      claims: initialClaims.map((claim) => ({ ...claim, status: "judging" })),
      agents: buildAgents(selectedClaims, 5),
      progress: 88,
      stage: "Evidence Judge issuing final verdicts",
    },
    {
      stages: baseStages().map((stage) => ({ ...stage, status: "completed" as WorkflowStageStatus })),
      claims: initialClaims.map((claim) => ({ ...claim, status: "completed" })),
      agents: buildAgents(selectedClaims, 6),
      progress: 100,
      stage: "Investigation complete",
    },
  ];
}

function stateFor(
  stepIndex: number,
  elapsedSeconds: number,
  running: boolean,
  visibleEventIds: string[],
  completed: boolean
): InvestigationSimulationState {
  return {
    stepIndex,
    elapsedSeconds,
    running,
    visibleEventIds,
    completed,
    updatedAt: new Date().toISOString(),
  };
}

export function LiveClient({ id }: { id: string }) {
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageMessage, setStorageMessage] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [visibleEventIds, setVisibleEventIds] = useState<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loaded = getInvestigation(id);
    setInvestigation(loaded);
    if (loaded?.simulationState) {
      setStepIndex(loaded.simulationState.stepIndex);
      setElapsed(loaded.simulationState.elapsedSeconds);
      setVisibleEventIds(loaded.simulationState.visibleEventIds);
      setRunning(false);
    }
    const health = getStorageHealth();
    setStorageMessage(health.status === "available" ? "" : health.message);
    setLoading(false);
  }, [id]);

  const selectedClaims = investigation?.claims.filter((claim) => claim.selected) ?? [];
  const steps = buildSteps(selectedClaims);
  const events = buildEvents(selectedClaims);
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)] ?? steps[0];
  const visibleEvents = events.filter((event) => visibleEventIds.includes(event.id));
  const isComplete = stepIndex >= steps.length - 1;

  const persist = useCallback(
    (nextStep: number, nextElapsed: number, nextRunning: boolean, nextEventIds: string[], completed: boolean) => {
      const next = saveSimulationState(
        id,
        stateFor(nextStep, nextElapsed, nextRunning, nextEventIds, completed)
      );
      if (next) setInvestigation(next);
      const health = getStorageHealth();
      setStorageMessage(health.status === "available" ? "" : health.message);
    },
    [id]
  );

  const completeWithReport = useCallback(
    (nextStep: number, nextElapsed: number, nextEventIds: string[]) => {
      const latest = getInvestigation(id);
      if (!latest) return;
      const report = buildMockReport(latest, nextElapsed);
      const next = completeInvestigation(
        id,
        report,
        stateFor(nextStep, nextElapsed, false, nextEventIds, true)
      );
      if (next) setInvestigation(next);
      const health = getStorageHealth();
      setStorageMessage(health.status === "available" ? "" : health.message);
    },
    [id]
  );

  const advance = useCallback(() => {
    setStepIndex((previous) => {
      const nextStep = Math.min(previous + 1, steps.length - 1);
      const stepTime = (nextStep / Math.max(steps.length - 1, 1)) * Math.max(events.length * 8, 24);
      const nextEventIds = events.filter((event) => event.timestamp <= stepTime).map((event) => event.id);
      setVisibleEventIds(nextEventIds);
      const completed = nextStep >= steps.length - 1;
      if (completed) {
        setRunning(false);
        completeWithReport(nextStep, elapsed, nextEventIds);
      } else {
        persist(nextStep, elapsed, running, nextEventIds, false);
      }
      return nextStep;
    });
  }, [completeWithReport, elapsed, events, persist, running, steps.length]);

  useEffect(() => {
    if (running && !isComplete) {
      intervalRef.current = setInterval(advance, 2800);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [advance, isComplete, running]);

  useEffect(() => {
    if (running) {
      elapsedRef.current = setInterval(() => {
        setElapsed((previous) => {
          const nextElapsed = previous + 1;
          persist(stepIndex, nextElapsed, true, visibleEventIds, isComplete);
          return nextElapsed;
        });
      }, 1000);
    }
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [isComplete, persist, running, stepIndex, visibleEventIds]);

  useEffect(() => {
    if (eventScrollRef.current) {
      eventScrollRef.current.scrollTop = eventScrollRef.current.scrollHeight;
    }
  }, [visibleEvents]);

  function startSim() {
    setRunning(true);
    persist(stepIndex, elapsed, true, visibleEventIds, isComplete);
  }

  function pauseSim() {
    setRunning(false);
    persist(stepIndex, elapsed, false, visibleEventIds, isComplete);
  }

  function completeAll() {
    const finalStep = steps.length - 1;
    const allEventIds = events.map((event) => event.id);
    setStepIndex(finalStep);
    setVisibleEventIds(allEventIds);
    setRunning(false);
    completeWithReport(finalStep, elapsed, allEventIds);
  }

  if (loading) {
    return (
      <AppShell title="Live investigation">
        <div className="flex h-full items-center justify-center p-6">
          <div className="flex items-center gap-2 font-mono text-xs text-[#86ADC2]">
            <Loader2 className="h-4 w-4 animate-spin text-[#FF6B1A]" aria-hidden />
            Loading investigation...
          </div>
        </div>
      </AppShell>
    );
  }

  if (!investigation) {
    return <StatePanel title="Investigation not found" message={`No persisted investigation exists for ${id}.`} />;
  }

  if (selectedClaims.length === 0) {
    return (
      <AppShell title="Live investigation" investigation={investigation}>
        <div className="mx-auto max-w-xl p-6">
          <div className="rounded border border-[#FFC94D]/30 bg-[#3A2A0E] p-4">
            <h1 className="text-sm font-semibold text-[#E9F3F8]">No claims selected</h1>
            <p className="mt-1 text-sm text-[#86ADC2]">
              Select at least one claim before beginning the simulated investigation.
            </p>
            <Link href={`/investigations/${id}/claims`} className="mt-4 inline-flex rounded bg-[#FF6B1A] px-3 py-2 text-sm font-medium text-[#0B1E2E]">
              Return to claims
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const completedClaims = currentStep.claims.filter((claim) => claim.status === "completed").length;

  return (
    <AppShell title="Live investigation" investigation={investigation}>
      <div className="flex h-full flex-col">
        <div className="border-b border-[#1E4560] bg-[#123049] px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <HeaderStat label="Project" value={`${investigation.project.owner}/${investigation.project.repo}`} />
              <HeaderStat label="Claims" value={`${completedClaims} / ${currentStep.claims.length} complete`} />
              <HeaderStat label="Elapsed" value={formatDuration(elapsed)} />
            </div>

            <div className="flex items-center gap-2">
              {!isComplete ? (
                <>
                  {running ? (
                    <button onClick={pauseSim} className="flex items-center gap-1.5 rounded border border-[#1E4560] bg-[#123049] px-3 py-1.5 font-mono text-xs text-[#86ADC2] transition-colors hover:border-[#FF6B1A]/50 hover:text-[#E9F3F8]" aria-label="Pause simulation">
                      <Pause className="h-3.5 w-3.5" aria-hidden />
                      Pause
                    </button>
                  ) : (
                    <button onClick={startSim} className="flex items-center gap-1.5 rounded bg-[#FF6B1A] px-3 py-1.5 font-mono text-xs text-[#0B1E2E] transition-colors hover:bg-[#FF8540]" aria-label="Start simulation">
                      <Play className="h-3.5 w-3.5" aria-hidden />
                      {stepIndex === 0 ? "Start" : "Resume"}
                    </button>
                  )}
                  <button onClick={advance} className="flex items-center gap-1.5 rounded border border-[#1E4560] px-3 py-1.5 font-mono text-xs text-[#86ADC2] transition-colors hover:border-[#FF6B1A]/50 hover:text-[#E9F3F8]" aria-label="Advance to next event">
                    <SkipForward className="h-3.5 w-3.5" aria-hidden />
                    Next event
                  </button>
                  <button onClick={completeAll} className="rounded border border-[#1E4560] px-3 py-1.5 font-mono text-xs text-[#86ADC2] transition-colors hover:border-[#FF6B1A]/50 hover:text-[#E9F3F8]">
                    Complete
                  </button>
                </>
              ) : (
                <Link href={`/investigations/${id}/report`} className="flex items-center gap-2 rounded bg-[#FF6B1A] px-3 py-1.5 font-mono text-xs text-[#0B1E2E] transition-colors hover:bg-[#FF8540]">
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  Open report
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              )}
            </div>
          </div>

          {storageMessage && (
            <p className="mt-3 rounded border border-[#FFC94D]/30 bg-[#3A2A0E] px-3 py-2 font-mono text-xs text-[#FFC94D]" role="status">
              {storageMessage}
            </p>
          )}

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[10px] text-[#4F7590]">{currentStep.stage}</span>
              <span className="font-mono text-[10px] text-[#86ADC2]">{currentStep.progress}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[#1E4560]">
              <div className="h-full rounded-full bg-[#FF6B1A] transition-all duration-700" style={{ width: `${currentStep.progress}%` }} />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="hidden w-56 shrink-0 flex-col gap-0 overflow-y-auto border-r border-[#1E4560] p-4 lg:flex">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">Workflow stages</p>
            {currentStep.stages.map((stage) => <WorkflowStageRow key={stage.id} stage={stage} />)}
            <p className="mb-2 mt-5 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">Claims</p>
            {currentStep.claims.map((claim) => <ClaimProgressRow key={claim.id} claim={claim} />)}
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">Agent activity</p>
            <div className="flex flex-col gap-3">
              {currentStep.agents.map((agent) => <AgentRunCard key={agent.id} agent={agent} />)}
            </div>

            <div className="mt-5 lg:hidden">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">Workflow stages</p>
              <div className="mb-4 flex flex-col gap-0">
                {currentStep.stages.map((stage) => <WorkflowStageRow key={stage.id} stage={stage} />)}
              </div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">Claims</p>
              <div className="flex flex-col gap-0">
                {currentStep.claims.map((claim) => <ClaimProgressRow key={claim.id} claim={claim} />)}
              </div>
            </div>
          </div>

          <div className="hidden w-72 shrink-0 flex-col border-l border-[#1E4560] xl:flex">
            <div className="border-b border-[#1E4560] px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">Evidence events</p>
            </div>
            <div ref={eventScrollRef} className="flex-1 overflow-y-auto p-3" aria-live="polite" aria-label="Evidence event stream">
              {visibleEvents.length === 0 ? (
                <p className="py-6 text-center font-mono text-[10px] text-[#4F7590]">
                  {running ? "Waiting for events..." : "Start the investigation to see events."}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {visibleEvents.map((event) => {
                    const cfg = EVENT_TYPE_CONFIG[event.type];
                    return (
                      <div key={event.id} className="rounded border border-[#1E4560] bg-[#123049] p-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cfg.dot)} aria-hidden />
                          <span className={cn("font-mono text-[10px]", cfg.color)}>{cfg.label}</span>
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-[#86ADC2]">{event.text}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">{label}</p>
      <p className="font-mono text-xs font-medium text-[#E9F3F8]">{value}</p>
    </div>
  );
}

function StatePanel({ title, message }: { title: string; message: string }) {
  return (
    <AppShell title="Live investigation">
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded border border-[#F2796B]/30 bg-[#3A1414] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F2796B]" aria-hidden />
            <div>
              <h1 className="text-sm font-semibold text-[#E9F3F8]">{title}</h1>
              <p className="mt-1 text-sm text-[#86ADC2]">{message}</p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function WorkflowStageRow({ stage }: { stage: SimWorkflowStage }) {
  const isCompleted = stage.status === "completed";
  const isActive = stage.status === "active";
  const isFailed = stage.status === "failed";
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="shrink-0">
        {isCompleted ? <CheckCircle className="h-3.5 w-3.5 text-[#4FBF9A]" aria-hidden /> : isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF6B1A]" aria-hidden /> : isFailed ? <XCircle className="h-3.5 w-3.5 text-[#F2796B]" aria-hidden /> : <Circle className="h-3.5 w-3.5 text-[#4F7590]" aria-hidden />}
      </span>
      <span className={cn("text-xs", isCompleted && "text-[#86ADC2]", isActive && "font-medium text-[#E9F3F8]", isFailed && "text-[#F2796B]", stage.status === "pending" && "text-[#4F7590]", stage.status === "blocked" && "text-[#FFC94D]")}>{stage.label}</span>
    </div>
  );
}

function ClaimProgressRow({ claim }: { claim: SimClaim }) {
  const cfg = CLAIM_STATUS_CONFIG[claim.status];
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="min-w-0 truncate text-xs text-[#86ADC2]">{claim.statement}</span>
      <span className={cn("shrink-0 font-mono text-[10px]", cfg.color)}>{cfg.label}</span>
    </div>
  );
}

function AgentRunCard({ agent }: { agent: SimAgentRun }) {
  const Icon = agent.icon;
  const isRunning = agent.status === "running";
  const isCompleted = agent.status === "completed";
  const isFailed = agent.status === "failed";
  const isIdle = agent.status === "idle";
  return (
    <div className={cn("rounded border p-4 transition-colors", isRunning ? "border-[#FF6B1A]/40 bg-[#123049]" : isCompleted ? "border-[#1E4560] bg-[#123049]" : isFailed ? "border-[#F2796B]/40 bg-[#123049]" : "border-[#1E4560] bg-[#0D2436]")}>
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5 rounded p-1.5", isRunning ? "bg-[#FF6B1A]/15" : isCompleted ? "bg-[#4FBF9A]/10" : "bg-[#1E4560]")}>
          <Icon className={cn("h-4 w-4", isRunning ? "text-[#FF6B1A]" : isCompleted ? "text-[#4FBF9A]" : isFailed ? "text-[#F2796B]" : "text-[#4F7590]")} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("font-mono text-xs font-medium", isRunning ? "text-[#E9F3F8]" : isCompleted ? "text-[#86ADC2]" : "text-[#4F7590]")}>{agent.label}</span>
            {isRunning && <span className="flex items-center gap-1 font-mono text-[10px] text-[#FF6B1A]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF6B1A]" aria-hidden />Running</span>}
            {isCompleted && <span className="font-mono text-[10px] text-[#4FBF9A]">Done</span>}
            {isFailed && <span className="font-mono text-[10px] text-[#F2796B]">Failed</span>}
          </div>
          {!isIdle && <p className={cn("mt-1 text-xs leading-snug", isRunning ? "text-[#86ADC2]" : "text-[#4F7590]")}>{agent.task}</p>}
          {(isRunning || isCompleted) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <Stat label="Files" value={agent.filesInspected} />
              <Stat label="Evidence" value={agent.evidenceCollected} />
              <Stat label="Obligations" value={agent.proofChecked} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <span className="font-mono text-[10px] text-[#4F7590]">{label}: <span className="text-[#86ADC2]">{value}</span></span>;
}

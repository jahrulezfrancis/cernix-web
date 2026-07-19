"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import {
  ApiRequestError,
  getInvestigation,
  getInvestigationEvents,
} from "@/lib/api/investigation-client";
import { backendContinuationRoute, investigationResponseToUi } from "@/lib/api/backend-investigation-adapter";
import type { InvestigationEventResponse, InvestigationResponse } from "@/lib/contracts/investigation-api";
import {
  projectInvestigationLiveView,
  type LiveAgentCard,
  type LiveEventTone,
  type LiveEventView,
  type LiveWorkflowStage,
} from "@/lib/live/investigation-live-projection";
import { cn, formatDuration } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Circle,
  FileText,
  Gavel,
  Loader2,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";

const TERMINAL = new Set(["completed", "completed_with_limitations", "failed"]);

const EVENT_TONE_STYLES: Record<LiveEventTone, { dot: string; label: string }> = {
  neutral: { dot: "bg-[#86ADC2]", label: "text-[#86ADC2]" },
  success: { dot: "bg-[#4FBF9A]", label: "text-[#4FBF9A]" },
  warning: { dot: "bg-[#FFC94D]", label: "text-[#FFC94D]" },
  error: { dot: "bg-[#F2796B]", label: "text-[#F2796B]" },
  active: { dot: "bg-[#FF6B1A]", label: "text-[#FF6B1A]" },
};

const AGENT_ICONS = {
  snapshot: Search,
  planner: FileText,
  investigator: Search,
  skeptic: ShieldAlert,
  judge: Gavel,
} as const;

export function BackendLiveClient({ id }: { id: string }) {
  const [investigation, setInvestigation] = useState<InvestigationResponse | null>(null);
  const [events, setEvents] = useState<InvestigationEventResponse[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const eventScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getInvestigation(id);
        if (cancelled) return;
        setInvestigation(loaded);
        const initial = await getInvestigationEvents(id, 0, 50);
        if (cancelled) return;
        setEvents(initial.events);
        setCursor(initial.nextCursor);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof ApiRequestError ? cause.message : "Unable to load investigation.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!investigation || TERMINAL.has(investigation.status)) return;
    const timer = setInterval(async () => {
      try {
        const [latest, page] = await Promise.all([
          getInvestigation(id),
          getInvestigationEvents(id, cursor, 50),
        ]);
        setInvestigation(latest);
        if (page.events.length) {
          setEvents((current) => {
            const seen = new Set(current.map((event) => event.sequence));
            return [...current, ...page.events.filter((event) => !seen.has(event.sequence))];
          });
          setCursor(page.nextCursor);
        }
      } catch {
        // Keep polling on transient failures.
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [id, investigation, cursor]);

  useEffect(() => {
    if (!investigation?.startedAt) return;
    const startedAt = new Date(investigation.startedAt).getTime();
    const endAt = investigation.completedAt ? new Date(investigation.completedAt).getTime() : Date.now();

    const update = () => {
      setElapsedSeconds(Math.max(0, Math.floor((endAt - startedAt) / 1000)));
    };
    update();

    if (TERMINAL.has(investigation.status)) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [investigation?.startedAt, investigation?.completedAt, investigation?.status]);

  const projection = useMemo(
    () => (investigation ? projectInvestigationLiveView(investigation, events) : null),
    [investigation, events]
  );

  useEffect(() => {
    if (eventScrollRef.current) {
      eventScrollRef.current.scrollTop = eventScrollRef.current.scrollHeight;
    }
  }, [projection?.events.length]);

  if (loading) {
    return (
      <AppShell title="Live investigation">
        <div className="flex h-full items-center justify-center p-6">
          <div className="flex items-center gap-2 font-mono text-xs text-[#86ADC2]">
            <Loader2 className="h-4 w-4 animate-spin text-[#FF6B1A]" aria-hidden />
            Loading live investigation...
          </div>
        </div>
      </AppShell>
    );
  }

  if (!investigation || !projection) {
    return (
      <AppShell title="Live investigation">
        <div className="mx-auto max-w-xl p-6">
          <div className="rounded border border-[#F2796B]/30 bg-[#3A1414] p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F2796B]" aria-hidden />
              <div>
                <h1 className="text-sm font-semibold text-[#E9F3F8]">Investigation not found</h1>
                <p className="mt-1 text-sm text-[#86ADC2]">{error || `No backend investigation exists for ${id}.`}</p>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  const ui = investigationResponseToUi(investigation);
  const reportReady = investigation.status === "completed" || investigation.status === "completed_with_limitations";
  const reportHref = backendContinuationRoute(id, investigation.status, reportReady);
  const isFailed = investigation.status === "failed";
  const isActive = !TERMINAL.has(investigation.status);

  return (
    <AppShell title="Live investigation" investigation={ui}>
      <div className="flex h-full flex-col">
        <header className="border-b border-[#1E4560] bg-[#123049] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-semibold text-[#E9F3F8]">Live investigation</h1>
                <StatusBadge status={investigation.status} />
              </div>
              <p className="mt-1 text-sm text-[#86ADC2]">
                Progress is derived from durable backend lifecycle events, not simulated percentages.
              </p>
            </div>

            {reportReady && (
              <Link
                href={reportHref}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF6B1A] px-3 py-2 font-mono text-xs text-[#0B1E2E] transition-colors hover:bg-[#FF8540]"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Open report
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-5">
            <HeaderStat
              label="Repository"
              value={`${investigation.repository.owner}/${investigation.repository.name}`}
            />
            <HeaderStat label="Claim status" value={projection.claimStatusLabel} />
            <HeaderStat
              label="Elapsed"
              value={investigation.startedAt ? formatDuration(elapsedSeconds) : "Not started"}
            />
          </div>

          {isFailed && investigation.failureCode && (
            <p
              className="mt-4 rounded border border-[#F2796B]/30 bg-[#3A1414] px-3 py-2 font-mono text-xs text-[#F2796B]"
              role="alert"
            >
              Failure code: {investigation.failureCode.replaceAll("_", " ")}
            </p>
          )}

          <div className="mt-4 rounded-lg border border-[#1E4560] bg-[#0D2436] p-3">
            <p className="text-xs leading-relaxed text-[#86ADC2]">{investigation.claim.statement}</p>
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] text-[#4F7590]">{projection.progressLabel}</span>
              <span className="font-mono text-[10px] text-[#86ADC2]">{projection.progressPercent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#1E4560]">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  isFailed ? "bg-[#F2796B]" : "bg-[#FF6B1A]"
                )}
                style={{ width: `${projection.progressPercent}%` }}
              />
            </div>
          </div>

          {isActive && (
            <p className="mt-3 flex items-center gap-2 font-mono text-[10px] text-[#86ADC2]" role="status">
              <Loader2 className="h-3 w-3 animate-spin text-[#FF6B1A]" aria-hidden />
              Polling backend events every 2 seconds
            </p>
          )}
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-[#1E4560] p-4 lg:flex">
            <SectionLabel>Workflow stages</SectionLabel>
            <div className="flex flex-col">
              {projection.workflowStages.map((stage) => (
                <WorkflowStageRow key={stage.id} stage={stage} />
              ))}
            </div>

            <SectionLabel className="mt-6">Claim</SectionLabel>
            <div className="rounded border border-[#1E4560] bg-[#123049] p-3">
              <p className="line-clamp-4 text-xs leading-relaxed text-[#86ADC2]">
                {investigation.claim.statement}
              </p>
              <p className="mt-2 font-mono text-[10px] text-[#FF6B1A]">{projection.claimStatusLabel}</p>
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto p-4">
            <SectionLabel>Agent activity</SectionLabel>
            <div className="flex flex-col gap-3">
              {projection.agents.map((agent) => (
                <AgentRunCard key={agent.id} agent={agent} />
              ))}
            </div>

            <div className="mt-6 lg:hidden">
              <SectionLabel>Workflow stages</SectionLabel>
              <div className="mb-4 flex flex-col">
                {projection.workflowStages.map((stage) => (
                  <WorkflowStageRow key={stage.id} stage={stage} />
                ))}
              </div>
            </div>
          </main>

          <aside className="hidden w-80 shrink-0 flex-col border-l border-[#1E4560] xl:flex">
            <div className="border-b border-[#1E4560] px-4 py-3">
              <SectionLabel>Activity feed</SectionLabel>
            </div>
            <div
              ref={eventScrollRef}
              className="flex-1 overflow-y-auto p-3"
              aria-live="polite"
              aria-label="Investigation activity feed"
            >
              {projection.events.length === 0 ? (
                <p className="py-6 text-center font-mono text-[10px] text-[#4F7590]">
                  Waiting for persisted events...
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {projection.events.map((eventView) => (
                    <ActivityEventCard key={eventView.sequence} event={eventView} />
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>

        <section className="border-t border-[#1E4560] p-4 xl:hidden">
          <SectionLabel>Activity feed</SectionLabel>
          <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-[#1E4560] bg-[#123049] p-3">
            {projection.events.length === 0 ? (
              <p className="py-4 text-center font-mono text-[10px] text-[#4F7590]">
                Waiting for persisted events...
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {projection.events.map((eventView) => (
                  <ActivityEventCard key={eventView.sequence} event={eventView} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("mb-2 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]", className)}>
      {children}
    </p>
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

function StatusBadge({ status }: { status: InvestigationResponse["status"] }) {
  const isFailed = status === "failed";
  const isComplete = status === "completed" || status === "completed_with_limitations";

  return (
    <span
      className={cn(
        "rounded border px-2 py-0.5 font-mono text-[10px]",
        isFailed
          ? "border-[#F2796B]/40 text-[#F2796B]"
          : isComplete
            ? "border-[#4FBF9A]/40 text-[#4FBF9A]"
            : "border-[#FF6B1A]/40 text-[#FF6B1A]"
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function WorkflowStageRow({ stage }: { stage: LiveWorkflowStage }) {
  const isCompleted = stage.status === "completed";
  const isActive = stage.status === "active";
  const isFailed = stage.status === "failed";

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="shrink-0">
        {isCompleted ? (
          <CheckCircle className="h-3.5 w-3.5 text-[#4FBF9A]" aria-hidden />
        ) : isActive ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF6B1A]" aria-hidden />
        ) : isFailed ? (
          <XCircle className="h-3.5 w-3.5 text-[#F2796B]" aria-hidden />
        ) : (
          <Circle className="h-3.5 w-3.5 text-[#4F7590]" aria-hidden />
        )}
      </span>
      <span
        className={cn(
          "text-xs",
          isCompleted && "text-[#86ADC2]",
          isActive && "font-medium text-[#E9F3F8]",
          isFailed && "text-[#F2796B]",
          stage.status === "pending" && "text-[#4F7590]"
        )}
      >
        {stage.label}
      </span>
    </div>
  );
}

function AgentRunCard({ agent }: { agent: LiveAgentCard }) {
  const Icon = AGENT_ICONS[agent.id as keyof typeof AGENT_ICONS] ?? Search;
  const isRunning = agent.status === "running";
  const isCompleted = agent.status === "completed";
  const isFailed = agent.status === "failed";
  const isIdle = agent.status === "idle";

  return (
    <div
      className={cn(
        "rounded border p-4 transition-colors",
        isRunning
          ? "border-[#FF6B1A]/40 bg-[#123049]"
          : isCompleted
            ? "border-[#1E4560] bg-[#123049]"
            : isFailed
              ? "border-[#F2796B]/40 bg-[#123049]"
              : "border-[#1E4560] bg-[#0D2436]"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 rounded p-1.5",
            isRunning ? "bg-[#FF6B1A]/15" : isCompleted ? "bg-[#4FBF9A]/10" : "bg-[#1E4560]"
          )}
        >
          <Icon
            className={cn(
              "h-4 w-4",
              isRunning
                ? "text-[#FF6B1A]"
                : isCompleted
                  ? "text-[#4FBF9A]"
                  : isFailed
                    ? "text-[#F2796B]"
                    : "text-[#4F7590]"
            )}
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "font-mono text-xs font-medium",
                isRunning ? "text-[#E9F3F8]" : isCompleted ? "text-[#86ADC2]" : "text-[#4F7590]"
              )}
            >
              {agent.label}
            </span>
            {isRunning && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-[#FF6B1A]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF6B1A]" aria-hidden />
                Running
              </span>
            )}
            {isCompleted && <span className="font-mono text-[10px] text-[#4FBF9A]">Done</span>}
            {isFailed && <span className="font-mono text-[10px] text-[#F2796B]">Failed</span>}
            {isIdle && <span className="font-mono text-[10px] text-[#4F7590]">Waiting</span>}
          </div>
          <p className={cn("mt-1 text-xs leading-snug", isIdle ? "text-[#4F7590]" : "text-[#86ADC2]")}>
            {agent.summary}
          </p>
          {agent.stats.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              {agent.stats.map((stat) => (
                <span key={stat.label} className="font-mono text-[10px] text-[#4F7590]">
                  {stat.label}: <span className="text-[#86ADC2]">{stat.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityEventCard({ event }: { event: LiveEventView }) {
  const [expanded, setExpanded] = useState(false);
  const tone = EVENT_TONE_STYLES[event.tone];

  return (
    <article className="rounded border border-[#1E4560] bg-[#123049] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
            <span className={cn("font-mono text-[10px]", tone.label)}>{event.title}</span>
            <span className="font-mono text-[10px] text-[#4F7590]">#{event.sequence}</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-[#86ADC2]">{event.detail}</p>
          <p className="mt-1 font-mono text-[10px] text-[#4F7590]">
            {new Date(event.createdAt).toLocaleString()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="shrink-0 rounded border border-[#1E4560] p-1 text-[#86ADC2] transition-colors hover:border-[#FF6B1A]/50 hover:text-[#E9F3F8]"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide event payload" : "Show event payload"}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </div>
      {expanded && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded border border-[#1E4560] bg-[#0D2436] p-2 font-mono text-[10px] text-[#86ADC2]">
          {JSON.stringify(event.rawPayload, null, 2)}
        </pre>
      )}
    </article>
  );
}

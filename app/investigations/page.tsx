"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { backendContinuationRoute } from "@/lib/api/backend-investigation-adapter";
import { ApiRequestError, listInvestigations } from "@/lib/api/investigation-client";
import { investigationSummaryToUi } from "@/lib/api/backend-investigation-adapter";
import { CommitBadge } from "@/components/ui/commit-badge";
import { formatDate, formatDuration } from "@/lib/utils";
import {
  PlusCircle,
  GitBranch,
  Clock,
  AlertCircle,
  ChevronRight,
  CircleDot,
} from "lucide-react";
import type { Investigation, InvestigationStatus, Verdict } from "@/lib/types";
import type { BackendLifecycleStatus } from "@/lib/contracts/investigation-api";

const STATUS_CONFIG: Record<
  InvestigationStatus,
  { label: string; color: string; dot: string }
> = {
  draft: { label: "Draft", color: "text-[#86ADC2]", dot: "bg-[#86ADC2]" },
  extracting_claims: { label: "Draft", color: "text-[#86ADC2]", dot: "bg-[#86ADC2]" },
  awaiting_claim_review: { label: "Awaiting review", color: "text-[#FFC94D]", dot: "bg-[#FFC94D]" },
  investigating: { label: "Investigating", color: "text-[#FF6B1A]", dot: "bg-[#FF6B1A] animate-pulse" },
  challenged: { label: "Challenged", color: "text-[#FF8540]", dot: "bg-[#FF8540]" },
  reinvestigating: { label: "Reinvestigating", color: "text-[#FF6B1A]", dot: "bg-[#FF6B1A] animate-pulse" },
  judging: { label: "Judging", color: "text-[#FF6B1A]", dot: "bg-[#FF6B1A] animate-pulse" },
  completed: { label: "Completed", color: "text-[#4FBF9A]", dot: "bg-[#4FBF9A]" },
  completed_with_limitations: { label: "Completed", color: "text-[#FFC94D]", dot: "bg-[#FFC94D]" },
  failed: { label: "Failed", color: "text-[#F2796B]", dot: "bg-[#F2796B]" },
  awaiting_review: { label: "Awaiting review", color: "text-[#FFC94D]", dot: "bg-[#FFC94D]" },
};

const VERDICT_COLORS: Record<Verdict, string> = {
  verified: "bg-[#4FBF9A]",
  partially_verified: "bg-[#FFC94D]",
  unverified: "bg-[#F2796B]",
  contradicted: "bg-[#FF8540]",
  inconclusive: "bg-[#86ADC2]",
};

function mapUiStatusToBackend(status: InvestigationStatus): BackendLifecycleStatus {
  switch (status) {
    case "investigating":
      return "investigating";
    case "challenged":
      return "challenging";
    case "reinvestigating":
      return "reinvestigating";
    default:
      return status as BackendLifecycleStatus;
  }
}

function investigationRoute(inv: Investigation): string | null {
  if (inv.status === "failed") return null;
  return backendContinuationRoute(
    inv.id,
    mapUiStatusToBackend(inv.status),
    Boolean(inv.report),
  );
}

function VerdictBar({ claims }: { claims: Investigation["claims"] }) {
  if (!claims.length) return null;
  const completed = claims.filter((c) => c.verdict);
  if (!completed.length) return null;
  const total = completed.length;
  return (
    <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-[#1E4560]" aria-hidden>
      {(["verified", "partially_verified", "unverified", "contradicted", "inconclusive"] as Verdict[]).map(
        (v) => {
          const count = completed.filter((c) => c.verdict === v).length;
          if (!count) return null;
          return (
            <div
              key={v}
              className={VERDICT_COLORS[v]}
              style={{ width: `${(count / total) * 100}%` }}
            />
          );
        }
      )}
    </div>
  );
}

export function InvestigationRow({ inv }: { inv: Investigation }) {
  const status = STATUS_CONFIG[inv.status];
  const isCompleted = inv.status === "completed" || inv.status === "completed_with_limitations";
  const isFailed = inv.status === "failed";
  const isAwaitingReview = inv.status === "awaiting_claim_review";
  const route = investigationRoute(inv);
  const actionLabel = isCompleted ? "Report" : isAwaitingReview ? "Review claim" : "View live";

  return (
    <div className="group border-b border-[#1E4560] last:border-b-0">
      <div className="flex items-center gap-4 px-5 py-4">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-sm font-medium text-[#E9F3F8]">
              {inv.project.owner}/{inv.project.repo}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="max-w-md truncate font-mono text-[10px] text-[#4F7590]">
              {inv.submission.content}
            </span>
            <CommitBadge sha={inv.repositorySnapshot.commitSha} />
            <span className="flex items-center gap-1 font-mono text-[10px] text-[#4F7590]">
              <GitBranch className="h-3 w-3" aria-hidden />
              {inv.repositorySnapshot.branch}
            </span>
            {inv.startedAt && (
              <span className="font-mono text-[10px] text-[#4F7590]">
                {formatDate(inv.startedAt)}
              </span>
            )}
            {inv.durationSeconds && (
              <span className="flex items-center gap-1 font-mono text-[10px] text-[#4F7590]">
                <Clock className="h-3 w-3" aria-hidden />
                {formatDuration(inv.durationSeconds)}
              </span>
            )}
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <VerdictBar claims={inv.claims} />
          {inv.requiresHumanReview && (
            <AlertCircle className="h-3.5 w-3.5 text-[#FFC94D]" aria-label="Requires human review" />
          )}
        </div>

        <span className={`hidden shrink-0 font-mono text-xs sm:block ${status.color}`}>
          {status.label}
        </span>

        <div className="flex shrink-0 items-center gap-2">
          {route ? (
            <Link href={route} className="flex items-center gap-1 rounded-lg border border-[#1E4560] bg-[#123049] px-2 py-1 font-mono text-[10px] text-[#86ADC2] transition-colors hover:border-[#FF6B1A]/50 hover:text-[#E9F3F8]">
              {actionLabel}<ChevronRight className="h-3 w-3" aria-hidden />
            </Link>
          ) : (
            <span className="rounded border border-[#1E4560] px-2 py-1 font-mono text-[10px] text-[#4F7590]">
              {isFailed ? "No automatic retry" : "Unavailable"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InvestigationsPage() {
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiMessage, setApiMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listInvestigations();
        if (cancelled) return;
        setInvestigations(result.investigations.map(investigationSummaryToUi));
      } catch (error) {
        if (!cancelled) {
          setApiMessage(error instanceof ApiRequestError ? error.message : "Unable to load investigations.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const completed = investigations.filter(
    (inv) => inv.status === "completed" || inv.status === "completed_with_limitations",
  ).length;
  const inProgress = investigations.filter(
    (inv) => !["completed", "completed_with_limitations", "failed", "awaiting_claim_review"].includes(inv.status),
  ).length;

  return (
    <AppShell title="Investigations">
      <div className="p-6">
        {apiMessage && (
          <p className="mb-4 rounded border border-[#FFC94D]/30 bg-[#3A2A0E] px-3 py-2 font-mono text-xs text-[#FFC94D]" role="status">
            {apiMessage}
          </p>
        )}
        {loading && <p className="mb-4 font-mono text-xs text-[#86ADC2]">Loading investigations…</p>}

        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-[#E9F3F8]">
              Investigations
            </h1>
            <p className="mt-0.5 text-sm text-[#86ADC2]">
              {investigations.length} saved {investigations.length === 1 ? "investigation" : "investigations"}
            </p>
          </div>
          <Link
            href="/investigations/new"
            className="flex items-center gap-2 rounded-lg bg-[#FF6B1A] px-3 py-2 text-sm font-medium text-[#0B1E2E] transition-colors hover:bg-[#FF8540]"
          >
            <PlusCircle className="h-4 w-4" aria-hidden />
            New investigation
          </Link>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { label: "Total", value: investigations.length, color: "text-[#E9F3F8]" },
            { label: "In progress", value: inProgress, color: inProgress > 0 ? "text-[#FF6B1A]" : "text-[#4FBF9A]" },
            { label: "Completed", value: completed, color: "text-[#4FBF9A]" },
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border border-[#1E4560] bg-[#123049] p-4"
            >
              <p className={`text-2xl font-semibold tabular-nums ${metric.color}`}>
                {metric.value}
              </p>
              <p className="mt-0.5 text-xs text-[#86ADC2]">{metric.label}</p>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-[#1E4560] bg-[#123049]">
          <div className="border-b border-[#1E4560] px-5 py-3">
            <div className="flex items-center gap-4">
              <CircleDot className="h-4 w-4 text-[#4F7590]" aria-hidden />
              <span className="font-mono text-xs text-[#4F7590]">
                Repository · Claim · Status
              </span>
              <span className="ml-auto font-mono text-xs text-[#4F7590]">
                Actions
              </span>
            </div>
          </div>

          {investigations.length === 0 && !loading ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-[#86ADC2]">No investigations yet.</p>
              <Link
                href="/investigations/new"
                className="mt-3 inline-flex text-sm text-[#FF6B1A] hover:underline"
              >
                Start your first investigation
              </Link>
            </div>
          ) : (
            investigations.map((inv) => (
              <InvestigationRow key={inv.id} inv={inv} />
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}

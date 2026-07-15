import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { DASHBOARD_INVESTIGATIONS } from "@/lib/mock-data";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { CommitBadge } from "@/components/ui/commit-badge";
import { formatDate, formatDuration } from "@/lib/utils";
import {
  PlusCircle,
  GitBranch,
  Clock,
  AlertCircle,
  RotateCcw,
  ChevronRight,
  CircleDot,
} from "lucide-react";
import type { Investigation, InvestigationStatus, Verdict } from "@/lib/types";

const STATUS_CONFIG: Record<
  InvestigationStatus,
  { label: string; color: string; dot: string }
> = {
  draft: { label: "Draft", color: "text-[#86ADC2]", dot: "bg-[#86ADC2]" },
  extracting_claims: { label: "Extracting claims", color: "text-[#FF6B1A]", dot: "bg-[#FF6B1A] animate-pulse" },
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

const SUBMISSION_LABELS: Record<string, string> = {
  hackathon_submission: "Hackathon",
  grant_application: "Grant",
  milestone_report: "Milestone",
  technical_due_diligence: "Due diligence",
  repository_documentation: "Documentation",
  other: "Other",
};

const VERDICT_COLORS: Record<Verdict, string> = {
  verified: "bg-[#4FBF9A]",
  partially_verified: "bg-[#FFC94D]",
  unverified: "bg-[#F2796B]",
  contradicted: "bg-[#FF8540]",
  inconclusive: "bg-[#86ADC2]",
};

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

function InvestigationRow({ inv }: { inv: Investigation }) {
  const status = STATUS_CONFIG[inv.status];
  const submissionLabel = SUBMISSION_LABELS[inv.submission.type];
  const isCompleted = inv.status === "completed" || inv.status === "completed_with_limitations";
  const isFailed = inv.status === "failed";
  const isAwaitingReview = inv.status === "awaiting_claim_review";
  const isInProgress = inv.status === "investigating";

  return (
    <div className="group border-b border-[#1E4560] last:border-b-0">
      <div className="flex items-center gap-4 px-5 py-4">
        {/* Status dot */}
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`}
          aria-hidden
        />

        {/* Main info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-sm font-medium text-[#E9F3F8]">
              {inv.project.owner}/{inv.project.repo}
            </span>
            <span className="font-mono text-xs text-[#4F7590]">{submissionLabel}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
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

        {/* Verdict bar */}
        <div className="hidden items-center gap-2 md:flex">
          <VerdictBar claims={inv.claims} />
          {inv.requiresHumanReview && (
            <AlertCircle className="h-3.5 w-3.5 text-[#FFC94D]" aria-label="Requires human review" />
          )}
        </div>

        {/* Status */}
        <span className={`hidden shrink-0 font-mono text-xs sm:block ${status.color}`}>
          {status.label}
        </span>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {isFailed && (
            <button
              className="flex items-center gap-1 rounded-lg border border-[#F2796B]/30 bg-[#3A1414] px-2 py-1 font-mono text-[10px] text-[#F2796B] transition-colors hover:bg-[#F2796B]/20"
              aria-label="Retry failed task"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              Retry
            </button>
          )}
          {isAwaitingReview && (
            <Link
              href={`/investigations/${inv.id}/claims`}
              className="flex items-center gap-1 rounded-lg border border-[#FFC94D]/30 bg-[#3A2A0E] px-2 py-1 font-mono text-[10px] text-[#FFC94D] transition-colors hover:bg-[#FFC94D]/20"
            >
              Review claims
            </Link>
          )}
          {isInProgress && (
            <Link
              href={`/investigations/${inv.id}/live`}
              className="flex items-center gap-1 rounded-lg border border-[#FF6B1A]/30 bg-[#FF6B1A]/10 px-2 py-1 font-mono text-[10px] text-[#FF6B1A] transition-colors hover:bg-[#FF6B1A]/20"
            >
              View live
            </Link>
          )}
          {isCompleted && (
            <Link
              href={`/investigations/${inv.id}/report`}
              className="flex items-center gap-1 rounded-lg border border-[#1E4560] bg-[#123049] px-2 py-1 font-mono text-[10px] text-[#86ADC2] transition-colors hover:border-[#FF6B1A]/50 hover:text-[#E9F3F8]"
            >
              Report
              <ChevronRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InvestigationsPage() {
  const totalClaims = DASHBOARD_INVESTIGATIONS.reduce(
    (acc, inv) => acc + inv.claims.length,
    0
  );
  const criticalUnsupported = DASHBOARD_INVESTIGATIONS.reduce(
    (acc, inv) =>
      acc +
      inv.claims.filter(
        (c) =>
          c.criticality === "critical" &&
          (c.verdict === "unverified" || c.verdict === "contradicted")
      ).length,
    0
  );
  const requiresReview = DASHBOARD_INVESTIGATIONS.filter(
    (inv) => inv.requiresHumanReview
  ).length;

  return (
    <AppShell title="Investigations">
      <div className="p-6">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-[#E9F3F8]">
              Investigations
            </h1>
            <p className="mt-0.5 text-sm text-[#86ADC2]">
              {DASHBOARD_INVESTIGATIONS.length} investigations
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

        {/* Summary metrics */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: "Total investigations",
              value: DASHBOARD_INVESTIGATIONS.length,
              color: "text-[#E9F3F8]",
            },
            {
              label: "Claims investigated",
              value: totalClaims,
              color: "text-[#E9F3F8]",
            },
            {
              label: "Critical unsupported",
              value: criticalUnsupported,
              color: criticalUnsupported > 0 ? "text-[#F2796B]" : "text-[#4FBF9A]",
            },
            {
              label: "Requiring review",
              value: requiresReview,
              color: requiresReview > 0 ? "text-[#FFC94D]" : "text-[#4FBF9A]",
            },
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

        {/* Investigation list */}
        <div className="rounded-lg border border-[#1E4560] bg-[#123049]">
          {/* Table header */}
          <div className="border-b border-[#1E4560] px-5 py-3">
            <div className="flex items-center gap-4">
              <CircleDot className="h-4 w-4 text-[#4F7590]" aria-hidden />
              <span className="font-mono text-xs text-[#4F7590]">
                Repository · Branch · Commit · Status
              </span>
              <span className="ml-auto font-mono text-xs text-[#4F7590]">
                Actions
              </span>
            </div>
          </div>

          {/* Rows */}
          {DASHBOARD_INVESTIGATIONS.map((inv) => (
            <InvestigationRow key={inv.id} inv={inv} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

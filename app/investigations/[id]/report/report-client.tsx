"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { ConfidenceIndicator } from "@/components/ui/confidence-indicator";
import { EvidenceCodeViewer } from "@/components/ui/evidence-code-viewer";
import { ProofObligationList } from "@/components/ui/proof-obligation-list";
import { CoverageMatrix } from "@/components/ui/coverage-matrix";
import { cn, formatDate, formatDuration, truncateHash } from "@/lib/utils";
import type { Report, Claim, Evidence, Verdict, ClaimCategory, Criticality, EvidenceStrength, Investigation } from "@/lib/types";
import {
  Copy,
  Check,
  Share2,
  GitCommitHorizontal,
  GitBranch,
  Calendar,
  Clock,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ShieldAlert,
  Eye,
  Wrench,
  Hash,
  FileText,
} from "lucide-react";

// ─── Label maps ───────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ClaimCategory, string> = {
  implementation: "Implementation",
  architecture: "Architecture",
  quality: "Quality",
  security_privacy: "Security & privacy",
  testing_delivery: "Testing & delivery",
  maintenance_governance: "Maintenance",
  milestone_completion: "Milestone",
  performance_outcome: "Performance",
};

const CRITICALITY_CONFIG: Record<
  Criticality,
  { label: string; color: string }
> = {
  critical: { label: "Critical", color: "text-[#F2796B]" },
  high: { label: "High", color: "text-[#FFC94D]" },
  medium: { label: "Medium", color: "text-[#FF6B1A]" },
  low: { label: "Low", color: "text-[#86ADC2]" },
};

const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  source_code: "Source code",
  configuration: "Configuration",
  test: "Test",
  ci_workflow: "CI workflow",
  documentation: "Documentation",
  commit_history: "Commit history",
  pull_request: "Pull request",
  dependency: "Dependency",
  deployment_manifest: "Deployment manifest",
  branch_protection: "Branch protection",
  runtime_artifact: "Runtime artifact",
};

const AGENT_ROLE_LABELS: Record<string, string> = {
  claim_analyst: "Claim Analyst",
  investigation_planner: "Investigation Planner",
  repository_investigator: "Repository Investigator",
  delivery_investigator: "Delivery Investigator",
  maintenance_investigator: "Maintenance Investigator",
  skeptic_agent: "Skeptic Agent",
  evidence_judge: "Evidence Judge",
};

const STRENGTH_CONFIG: Record<EvidenceStrength, { label: string; color: string; bar: string }> = {
  strong: { label: "Strong", color: "text-[#4FBF9A]", bar: "bg-[#4FBF9A]" },
  moderate: { label: "Moderate", color: "text-[#FFC94D]", bar: "bg-[#FFC94D]" },
  weak: { label: "Weak", color: "text-[#F2796B]", bar: "bg-[#F2796B]" },
  inconclusive: { label: "Inconclusive", color: "text-[#86ADC2]", bar: "bg-[#86ADC2]" },
};

const VERDICT_FILTER_OPTIONS: { value: "all" | Verdict | "critical"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "partially_verified", label: "Partial" },
  { value: "unverified", label: "Unverified" },
  { value: "contradicted", label: "Contradicted" },
  { value: "critical", label: "Critical only" },
];

type ViewMode = "reviewer" | "maintainer";

// ─── Component ────────────────────────────────────────────────────────────────

interface ReportClientProps {
  report: Report;
  investigationId: string;
  investigation?: Investigation | null;
}

export function ReportClient({ report, investigationId, investigation = null }: ReportClientProps) {
  const [selectedClaimId, setSelectedClaimId] = useState<string>(
    report.claims[0]?.id ?? ""
  );
  const [verdictFilter, setVerdictFilter] = useState<"all" | Verdict | "critical">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("reviewer");
  const [copied, setCopied] = useState(false);

  const selectedClaim = report.claims.find((c) => c.id === selectedClaimId);
  const judgment = selectedClaim ? report.judgments[selectedClaim.id] : null;
  const claimEvidence = selectedClaim ? (report.evidence[selectedClaim.id] ?? []) : [];
  const claimProofObligation = selectedClaim ? (report.proofObligations[selectedClaim.id] ?? []) : [];
  const claimChallenges = selectedClaim ? (report.challenges[selectedClaim.id] ?? []) : [];
  const claimGaps = selectedClaim ? (report.evidenceGaps[selectedClaim.id] ?? []) : [];
  const claimMaintainerActions = selectedClaim ? (report.maintainerActions[selectedClaim.id] ?? []) : [];

  const filteredClaims = report.claims.filter((c) => {
    if (verdictFilter === "all") return true;
    if (verdictFilter === "critical") return c.criticality === "critical";
    return c.verdict === verdictFilter;
  });

  function handleCopyId() {
    navigator.clipboard.writeText(report.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <AppShell
      title="Evidence report"
      investigation={investigation}
    >
      <div className="flex h-full flex-col overflow-hidden">
        {/* Report header */}
        <header className="border-b border-[#1E4560] bg-[#123049] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold text-[#E9F3F8]">
                  {report.projectName}
                </h1>
                <span className="rounded border border-[#1E4560] px-1.5 py-0.5 font-mono text-[10px] text-[#86ADC2]">
                  {report.submissionType.replace(/_/g, " ")}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1 font-mono text-xs text-[#86ADC2]">
                  {report.repositorySnapshot.owner}/{report.repositorySnapshot.repo}
                </span>
                <span className="flex items-center gap-1 font-mono text-xs text-[#86ADC2]">
                  <GitBranch className="h-3 w-3" aria-hidden />
                  {report.repositorySnapshot.branch}
                </span>
                <span className="flex items-center gap-1 font-mono text-xs text-[#FF6B1A]">
                  <GitCommitHorizontal className="h-3 w-3" aria-hidden />
                  {truncateHash(report.repositorySnapshot.commitSha)}
                </span>
                <span className="flex items-center gap-1 font-mono text-[10px] text-[#4F7590]">
                  <Calendar className="h-3 w-3" aria-hidden />
                  {formatDate(report.investigationDate)}
                </span>
                <span className="flex items-center gap-1 font-mono text-[10px] text-[#4F7590]">
                  <Clock className="h-3 w-3" aria-hidden />
                  {formatDuration(report.durationSeconds)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Report ID */}
              <button
                onClick={handleCopyId}
                className="flex items-center gap-1.5 rounded border border-[#1E4560] bg-[#123049] px-2.5 py-1 font-mono text-[10px] text-[#4F7590] transition-colors hover:border-[#FF6B1A]/40 hover:text-[#86ADC2]"
                aria-label="Copy report ID"
              >
                <Hash className="h-3 w-3" aria-hidden />
                {report.id}
                {copied ? (
                  <Check className="h-3 w-3 text-[#4FBF9A]" aria-hidden />
                ) : (
                  <Copy className="h-3 w-3" aria-hidden />
                )}
              </button>
              {/* View mode toggle */}
              <div className="flex rounded border border-[#1E4560] overflow-hidden">
                <button
                  onClick={() => setViewMode("reviewer")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10px] transition-colors",
                    viewMode === "reviewer"
                      ? "bg-[#1E4560] text-[#FF6B1A]"
                      : "bg-[#123049] text-[#4F7590] hover:text-[#86ADC2]"
                  )}
                  aria-pressed={viewMode === "reviewer"}
                >
                  <Eye className="h-3 w-3" aria-hidden />
                  Reviewer
                </button>
                <button
                  onClick={() => setViewMode("maintainer")}
                  className={cn(
                    "flex items-center gap-1.5 border-l border-[#1E4560] px-2.5 py-1 font-mono text-[10px] transition-colors",
                    viewMode === "maintainer"
                      ? "bg-[#1E4560] text-[#FF6B1A]"
                      : "bg-[#123049] text-[#4F7590] hover:text-[#86ADC2]"
                  )}
                  aria-pressed={viewMode === "maintainer"}
                >
                  <Wrench className="h-3 w-3" aria-hidden />
                  Maintainer
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Executive summary */}
        <div className="border-b border-[#1E4560] px-5 py-4">
          <div className="flex flex-wrap gap-6">
            {/* Verdict summary counts */}
            <div className="flex flex-wrap items-center gap-4">
              <SummaryCount label="Investigated" value={report.claimsInvestigated} color="text-[#E9F3F8]" />
              <SummaryCount label="Verified" value={report.verified} color="text-[#4FBF9A]" />
              <SummaryCount label="Partial" value={report.partiallyVerified} color="text-[#FFC94D]" />
              <SummaryCount label="Unverified" value={report.unverified} color="text-[#F2796B]" />
              <SummaryCount label="Contradicted" value={report.contradicted} color="text-[#F2796B]" />
              <SummaryCount label="Inconclusive" value={report.inconclusive} color="text-[#86ADC2]" />
              <div className="flex flex-col">
                <span className="font-mono text-[10px] text-[#4F7590]">Coverage</span>
                <span className="font-mono text-xl font-semibold tabular-nums text-[#FF6B1A]">
                  {report.overallCoverage}%
                </span>
              </div>
            </div>
          </div>

          {/* Summary sentence */}
          <p className="mt-3 text-sm leading-relaxed text-[#86ADC2]">
            {report.summarySentence}
          </p>

          {/* Critical findings — reviewer only */}
          {viewMode === "reviewer" && report.criticalFindings.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {report.criticalFindings.map((finding, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded border border-[#F2796B]/20 bg-[#F2796B]/5 px-3 py-2"
                >
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F2796B]"
                    aria-hidden
                  />
                  <p className="text-xs text-[#E9F3F8]">{finding}</p>
                </div>
              ))}
            </div>
          )}

          {/* Coverage matrix — compact */}
          <div className="mt-4">
            <CoverageMatrix coverage={report.coverage} compact />
          </div>
        </div>

        {/* Split: claim list + evidence case */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Claim list */}
          <div className="w-full shrink-0 overflow-y-auto border-r border-[#1E4560] lg:w-[340px] xl:w-[380px]">
            {/* Filter bar */}
            <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-[#1E4560] bg-[#0D2436] px-3 py-2">
              {VERDICT_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setVerdictFilter(opt.value)}
                  className={cn(
                    "rounded px-2 py-0.5 font-mono text-[10px] transition-colors",
                    verdictFilter === opt.value
                      ? "bg-[#1E4560] text-[#FF6B1A]"
                      : "text-[#4F7590] hover:text-[#86ADC2]"
                  )}
                  aria-pressed={verdictFilter === opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col">
              {filteredClaims.map((claim) => (
                <ClaimRow
                  key={claim.id}
                  claim={claim}
                  selected={claim.id === selectedClaimId}
                  onSelect={() => setSelectedClaimId(claim.id)}
                  viewMode={viewMode}
                />
              ))}
              {filteredClaims.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-[#4F7590]">
                  No claims match this filter.
                </p>
              )}
            </div>
          </div>

          {/* Evidence Case detail */}
          {selectedClaim && judgment && (
            <div className="hidden min-w-0 flex-1 overflow-y-auto p-5 lg:block">
              <EvidenceCaseDetail
                claim={selectedClaim}
                judgment={judgment}
                evidence={claimEvidence}
                proofObligations={claimProofObligation}
                challenges={claimChallenges}
                evidenceGaps={claimGaps}
                maintainerActions={claimMaintainerActions}
                viewMode={viewMode}
              />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ─── Claim row ────────────────────────────────────────────────────────────────

function ClaimRow({
  claim,
  selected,
  onSelect,
  viewMode,
}: {
  claim: Claim;
  selected: boolean;
  onSelect: () => void;
  viewMode: ViewMode;
}) {
  const critConfig = CRITICALITY_CONFIG[claim.criticality];

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full border-b border-[#1E4560] p-4 text-left transition-colors last:border-b-0",
        selected ? "bg-[#1E4560]" : "hover:bg-[#123049]"
      )}
      aria-pressed={selected}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-xs leading-snug",
              selected ? "text-[#E9F3F8]" : "text-[#86ADC2]"
            )}
          >
            {claim.normalizedInterpretation}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {claim.verdict && <VerdictBadge verdict={claim.verdict} size="sm" />}
            {claim.confidence && (
              <ConfidenceIndicator confidence={claim.confidence} showLabel={false} />
            )}
            <span className={cn("font-mono text-[10px]", critConfig.color)}>
              {critConfig.label}
            </span>
            {claim.requiresHumanReview && (
              <span className="font-mono text-[10px] text-[#FFC94D]">
                Review required
              </span>
            )}
          </div>

          {viewMode === "maintainer" && claim.openLimitations > 0 && (
            <p className="mt-1.5 font-mono text-[10px] text-[#FFC94D]">
              {claim.openLimitations} open limitation{claim.openLimitations !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <ChevronRight
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 transition-colors",
            selected ? "text-[#FF6B1A]" : "text-[#4F7590]"
          )}
          aria-hidden
        />
      </div>
    </button>
  );
}

// ─── Evidence Case detail ─────────────────────────────────────────────────────

function EvidenceCaseDetail({
  claim,
  judgment,
  evidence,
  proofObligations,
  challenges,
  evidenceGaps,
  maintainerActions,
  viewMode,
}: {
  claim: Claim;
  judgment: NonNullable<Report["judgments"][string]>;
  evidence: Evidence[];
  proofObligations: NonNullable<Report["proofObligations"][string]>;
  challenges: NonNullable<Report["challenges"][string]>;
  evidenceGaps: NonNullable<Report["evidenceGaps"][string]>;
  maintainerActions: string[];
  viewMode: ViewMode;
}) {
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(null);
  const [expandedChallengeId, setExpandedChallengeId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {/* Claim definition */}
      <Section label="Claim">
        <div className="rounded border border-[#1E4560] bg-[#123049] p-4">
          <p className="text-sm text-[#E9F3F8]">{claim.originalStatement}</p>
          <p className="mt-2 text-xs leading-relaxed text-[#86ADC2]">
            {claim.normalizedInterpretation}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Tag>{CATEGORY_LABELS[claim.category]}</Tag>
            <Tag
              className={cn(
                "border",
                CRITICALITY_CONFIG[claim.criticality].color
              )}
            >
              {CRITICALITY_CONFIG[claim.criticality].label}
            </Tag>
          </div>
          {claim.preservedQualifiers.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
                Preserved qualifiers
              </p>
              <div className="flex flex-wrap gap-1.5">
                {claim.preservedQualifiers.map((q) => (
                  <span
                    key={q}
                    className="rounded bg-[#1E4560] px-2 py-0.5 font-mono text-[10px] text-[#FF8540]"
                  >
                    {q}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Verdict */}
      <Section label="Verdict">
        <div className="rounded border border-[#1E4560] bg-[#123049] p-4">
          <div className="flex flex-wrap items-center gap-3">
            {claim.verdict && <VerdictBadge verdict={claim.verdict} />}
            {claim.confidence && (
              <ConfidenceIndicator confidence={claim.confidence} />
            )}
          </div>
          <p className="mt-3 text-sm font-medium text-[#E9F3F8]">
            {judgment.summary}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-[#86ADC2]">
            {judgment.reasoning}
          </p>
          {judgment.unprovenAspects.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
                What remains unproven
              </p>
              <ul className="flex flex-col gap-1">
                {judgment.unprovenAspects.map((aspect, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#FFC94D]">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#FFC94D]" aria-hidden />
                    {aspect}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {judgment.whatCouldChangeVerdict.length > 0 && viewMode === "maintainer" && (
            <div className="mt-3">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
                What could change this verdict
              </p>
              <ul className="flex flex-col gap-1">
                {judgment.whatCouldChangeVerdict.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#86ADC2]">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#FF6B1A]" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* Proof obligations */}
      {proofObligations.length > 0 && (
        <Section label="Proof obligations">
          <ProofObligationList obligations={proofObligations} />
        </Section>
      )}

      {/* Evidence items */}
      {evidence.length > 0 && (
        <Section label={`Evidence (${evidence.length})`}>
          <div className="flex flex-col gap-3">
            {evidence.map((ev) => (
              <EvidenceItem
                key={ev.id}
                evidence={ev}
                expanded={expandedEvidenceId === ev.id}
                onToggle={() =>
                  setExpandedEvidenceId((prev) =>
                    prev === ev.id ? null : ev.id
                  )
                }
                viewMode={viewMode}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Challenges */}
      {challenges.length > 0 && (
        <Section label="Skeptic challenges">
          <div className="flex flex-col gap-3">
            {challenges.map((ch) => (
              <div
                key={ch.id}
                className="rounded border border-[#FFC94D]/25 bg-[#123049] p-4"
              >
                <div className="flex items-start gap-2">
                  <ShieldAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#FFC94D]"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-[#FFC94D]">
                        {AGENT_ROLE_LABELS[ch.challengingAgent] ?? ch.challengingAgent}
                      </span>
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                          ch.severity === "critical"
                            ? "border-[#F2796B]/30 text-[#F2796B]"
                            : ch.severity === "major"
                            ? "border-[#FFC94D]/30 text-[#FFC94D]"
                            : "border-[#86ADC2]/30 text-[#86ADC2]"
                        )}
                      >
                        {ch.severity}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#E9F3F8]">
                      {ch.challengeText}
                    </p>
                    {ch.resolution && (
                      <div className="mt-3 rounded border border-[#1E4560] bg-[#1E4560] p-2.5">
                        <p className="mb-0.5 font-mono text-[10px] text-[#4F7590]">
                          Resolution
                        </p>
                        <p className="text-xs leading-relaxed text-[#86ADC2]">
                          {ch.resolution}
                        </p>
                        {ch.verdictChanged && ch.verdictBefore && ch.verdictAfter && (
                          <div className="mt-2 flex items-center gap-2">
                            <VerdictBadge verdict={ch.verdictBefore} size="sm" />
                            <ChevronRight className="h-3 w-3 text-[#4F7590]" aria-hidden />
                            <VerdictBadge verdict={ch.verdictAfter} size="sm" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Evidence gaps */}
      {evidenceGaps.length > 0 && (
        <Section label="Limitations">
          <div className="flex flex-col gap-2">
            {evidenceGaps.map((gap) => (
              <div
                key={gap.id}
                className="rounded border border-[#1E4560] bg-[#123049] p-3"
              >
                <p className="text-xs font-medium text-[#E9F3F8]">{gap.description}</p>
                <p className="mt-1 text-xs text-[#4F7590]">{gap.unavailableReason}</p>
                <p className="mt-1.5 text-xs text-[#FFC94D]">{gap.impactOnVerdict}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Maintainer actions */}
      {maintainerActions.length > 0 && (viewMode === "maintainer" || viewMode === "reviewer") && (
        <Section label="Maintainer actions">
          <div className="rounded border border-[#1E4560] bg-[#123049] p-4">
            <ol className="flex flex-col gap-2">
              {maintainerActions.map((action, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1E4560] font-mono text-[10px] text-[#FF6B1A]">
                    {i + 1}
                  </span>
                  <p className="text-xs leading-relaxed text-[#86ADC2]">{action}</p>
                </li>
              ))}
            </ol>
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Evidence item ────────────────────────────────────────────────────────────

function EvidenceItem({
  evidence,
  expanded,
  onToggle,
  viewMode,
}: {
  evidence: Evidence;
  expanded: boolean;
  onToggle: () => void;
  viewMode: ViewMode;
}) {
  const [copiedId, setCopiedId] = useState(false);
  const strengthCfg = STRENGTH_CONFIG[evidence.strength];

  function copyId() {
    navigator.clipboard.writeText(evidence.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1500);
  }

  return (
    <div className="rounded border border-[#1E4560] bg-[#123049]">
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-[#1E4560] px-1.5 py-0.5 font-mono text-[10px] text-[#86ADC2]">
                {EVIDENCE_TYPE_LABELS[evidence.type] ?? evidence.type}
              </span>
              <span className={cn("font-mono text-[10px] font-medium", strengthCfg.color)}>
                {strengthCfg.label}
              </span>
              {evidence.validation === "accepted" && (
                <span className="font-mono text-[10px] text-[#4FBF9A]">Accepted</span>
              )}
              {evidence.validation === "rejected" && (
                <span className="font-mono text-[10px] text-[#F2796B]">Rejected</span>
              )}
              {evidence.validation === "contested" && (
                <span className="font-mono text-[10px] text-[#FFC94D]">Contested</span>
              )}
            </div>
            <p className="mt-1.5 text-xs leading-snug text-[#E9F3F8]">
              {evidence.observation}
            </p>
            <p className="mt-1 text-xs text-[#86ADC2]">{evidence.relevance}</p>
          </div>

          <button
            onClick={onToggle}
            className="ml-2 shrink-0 rounded p-1 text-[#4F7590] transition-colors hover:bg-[#1E4560] hover:text-[#86ADC2]"
            aria-label={expanded ? "Collapse evidence" : "Expand evidence"}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>

        {/* Meta row */}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {evidence.repositoryPath && (
            <span className="font-mono text-[10px] text-[#4F7590]">
              {evidence.repositoryPath}
            </span>
          )}
          {evidence.lineStart && (
            <span className="font-mono text-[10px] text-[#4F7590]">
              L{evidence.lineStart}
              {evidence.lineEnd && evidence.lineEnd !== evidence.lineStart
                ? `–${evidence.lineEnd}`
                : ""}
            </span>
          )}
          {evidence.commitSha && (
            <button
              className="flex items-center gap-1 font-mono text-[10px] text-[#FF6B1A] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(evidence.commitSha!);
              }}
              aria-label="Copy commit SHA"
            >
              <GitCommitHorizontal className="h-3 w-3" aria-hidden />
              {truncateHash(evidence.commitSha)}
            </button>
          )}
          <span className="font-mono text-[10px] text-[#4F7590]">
            {AGENT_ROLE_LABELS[evidence.discoveredBy] ?? evidence.discoveredBy}
          </span>
          <button
            onClick={copyId}
            className="ml-auto flex items-center gap-1 font-mono text-[10px] text-[#4F7590] hover:text-[#86ADC2]"
            aria-label="Copy evidence ID"
          >
            {evidence.id}
            {copiedId ? (
              <Check className="h-3 w-3 text-[#4FBF9A]" aria-hidden />
            ) : (
              <Copy className="h-3 w-3" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {/* Expanded: code */}
      {expanded && evidence.codeExcerpt && (
        <div className="border-t border-[#1E4560]">
          <EvidenceCodeViewer
            code={evidence.codeExcerpt}
            path={evidence.repositoryPath}
            lineStart={evidence.lineStart}
            lineEnd={evidence.lineEnd}
          />
        </div>
      )}
    </div>
  );
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
        {label}
      </h2>
      {children}
    </div>
  );
}

function SummaryCount({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[10px] text-[#4F7590]">{label}</span>
      <span className={cn("font-mono text-xl font-semibold tabular-nums", color)}>
        {value}
      </span>
    </div>
  );
}

function Tag({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded border border-[#1E4560] px-1.5 py-0.5 font-mono text-[10px] text-[#86ADC2]",
        className
      )}
    >
      {children}
    </span>
  );
}


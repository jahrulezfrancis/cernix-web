"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { ConfidenceIndicator } from "@/components/ui/confidence-indicator";
import { EvidenceCodeViewer } from "@/components/ui/evidence-code-viewer";
import { ProofObligationList } from "@/components/ui/proof-obligation-list";
import { CoverageMatrix } from "@/components/ui/coverage-matrix";
import { cn, formatDate, formatDuration, truncateHash } from "@/lib/utils";
import type {
  Report,
  Claim,
  Evidence,
  Verdict,
  ClaimCategory,
  Criticality,
  EvidenceStrength,
  Investigation,
} from "@/lib/types";
import {
  Copy,
  Check,
  GitCommitHorizontal,
  GitBranch,
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
  Layers,
  Search,
  ClipboardList,
} from "lucide-react";

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

const CRITICALITY_CONFIG: Record<Criticality, { label: string; color: string }> = {
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

const STRENGTH_CONFIG: Record<EvidenceStrength, { label: string; color: string }> = {
  strong: { label: "Strong", color: "text-[#4FBF9A]" },
  moderate: { label: "Moderate", color: "text-[#FFC94D]" },
  weak: { label: "Weak", color: "text-[#F2796B]" },
  inconclusive: { label: "Inconclusive", color: "text-[#86ADC2]" },
};

const VERDICT_FILTER_OPTIONS: { value: "all" | Verdict | "critical"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "verified", label: "Verified" },
  { value: "partially_verified", label: "Partial" },
  { value: "unverified", label: "Unverified" },
  { value: "contradicted", label: "Contradicted" },
  { value: "critical", label: "Critical" },
];

type ViewMode = "reviewer" | "maintainer";
type DetailTab = "overview" | "evidence" | "review";

interface ReportClientProps {
  report: Report;
  investigationId: string;
  investigation?: Investigation | null;
}

export function ReportClient({ report, investigationId, investigation = null }: ReportClientProps) {
  const [selectedClaimId, setSelectedClaimId] = useState<string>(report.claims[0]?.id ?? "");
  const [verdictFilter, setVerdictFilter] = useState<"all" | Verdict | "critical">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("reviewer");
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [coverageExpanded, setCoverageExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const selectedClaim = report.claims.find((claim) => claim.id === selectedClaimId);
  const judgment = selectedClaim ? report.judgments[selectedClaim.id] : null;
  const claimEvidence = selectedClaim ? (report.evidence[selectedClaim.id] ?? []) : [];
  const claimProofObligation = selectedClaim ? (report.proofObligations[selectedClaim.id] ?? []) : [];
  const claimChallenges = selectedClaim ? (report.challenges[selectedClaim.id] ?? []) : [];
  const claimGaps = selectedClaim ? (report.evidenceGaps[selectedClaim.id] ?? []) : [];
  const claimMaintainerActions = selectedClaim ? (report.maintainerActions[selectedClaim.id] ?? []) : [];

  const filteredClaims = report.claims.filter((claim) => {
    if (verdictFilter === "all") return true;
    if (verdictFilter === "critical") return claim.criticality === "critical";
    return claim.verdict === verdictFilter;
  });

  const reviewItemCount = claimChallenges.length + claimGaps.length +
    (viewMode === "maintainer" ? claimMaintainerActions.length : 0);

  const singleClaim = report.claims.length === 1;
  const primaryClaim = selectedClaim ?? report.claims[0] ?? null;
  const primaryJudgment = primaryClaim ? report.judgments[primaryClaim.id] : null;

  const summaryStats = [
    { label: "Verified", value: report.verified, color: "text-[#4FBF9A]" },
    { label: "Partial", value: report.partiallyVerified, color: "text-[#FFC94D]" },
    { label: "Unverified", value: report.unverified, color: "text-[#F2796B]" },
    { label: "Contradicted", value: report.contradicted, color: "text-[#FF8540]" },
    { label: "Inconclusive", value: report.inconclusive, color: "text-[#86ADC2]" },
  ].filter((stat) => stat.value > 0);

  function handleCopyId() {
    navigator.clipboard.writeText(report.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function selectClaim(claimId: string) {
    setSelectedClaimId(claimId);
    setDetailTab("overview");
  }

  return (
    <AppShell title="Evidence report" investigation={investigation}>
      <div className="flex flex-col">
        <header className="border-b border-[#1E4560] bg-[#123049] px-5 py-5 lg:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-[#E9F3F8]">{report.projectName}</h1>
                <span className="rounded border border-[#1E4560] px-2 py-0.5 font-mono text-[10px] text-[#86ADC2]">
                  {report.submissionType.replace(/_/g, " ")}
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#86ADC2]">
                Evidence report for {report.claimsInvestigated} investigated claim
                {report.claimsInvestigated === 1 ? "" : "s"} against an immutable repository snapshot.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleCopyId}
                className="flex items-center gap-1.5 rounded border border-[#1E4560] bg-[#0D2436] px-2.5 py-1.5 font-mono text-[10px] text-[#86ADC2] transition-colors hover:border-[#FF6B1A]/40"
                aria-label="Copy report ID"
              >
                <Hash className="h-3 w-3" aria-hidden />
                {truncateHash(report.id)}
                {copied ? <Check className="h-3 w-3 text-[#4FBF9A]" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
              </button>
              <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetaTile
              icon={FileText}
              label="Repository"
              value={`${report.repositorySnapshot.owner}/${report.repositorySnapshot.repo}`}
            />
            <MetaTile icon={GitBranch} label="Branch" value={report.repositorySnapshot.branch} />
            <MetaTile
              icon={GitCommitHorizontal}
              label="Commit"
              value={truncateHash(report.repositorySnapshot.commitSha)}
              accent
              href={`https://github.com/${report.repositorySnapshot.owner}/${report.repositorySnapshot.repo}/commit/${report.repositorySnapshot.commitSha}`}
            />
            <MetaTile
              icon={Clock}
              label="Investigation"
              value={`${formatDate(report.investigationDate)} · ${formatDuration(report.durationSeconds)}`}
            />
          </div>

          <ProvenanceBar report={report} />

          <div className="mt-4">
            <Link
              href={`/investigations/${investigationId}/live`}
              className="inline-flex items-center gap-1 font-mono text-[10px] text-[#4F7590] transition-colors hover:text-[#FF6B1A]"
            >
              View investigation timeline
              <ChevronRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
        </header>

        <section className="border-b border-[#1E4560] bg-[#0D2436]/40 px-5 py-5 lg:px-6">
          {primaryClaim && primaryJudgment && (
            <VerdictHero claim={primaryClaim} judgment={primaryJudgment} disposition={report.completionDisposition} />
          )}

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0">
              <SectionEyebrow>Executive summary</SectionEyebrow>
              <p className="mt-2 text-base leading-relaxed text-[#E9F3F8]">{report.summarySentence}</p>

              {report.criticalFindings.length > 0 && (
                <div className="mt-4 flex flex-col gap-2">
                  {report.criticalFindings.map((finding, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-2.5 rounded-lg border border-[#F2796B]/20 bg-[#F2796B]/5 px-3 py-2.5"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F2796B]" aria-hidden />
                      <p className="text-sm leading-relaxed text-[#E9F3F8]">{finding}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[#1E4560] bg-[#123049] p-4">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">Verified claims</p>
              <p className="mt-1 font-mono text-3xl font-semibold tabular-nums text-[#FF6B1A]">
                {report.overallCoverage}%
              </p>
              <p className="mt-1 text-xs text-[#86ADC2]">
                {report.verified} of {report.claimsInvestigated} claim{report.claimsInvestigated === 1 ? "" : "s"} fully verified
              </p>
              {summaryStats.length > 0 && (
                <div className="mt-4 flex flex-col gap-2 border-t border-[#1E4560] pt-4">
                  {summaryStats.map((stat) => (
                    <div key={stat.label} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-[#86ADC2]">{stat.label}</span>
                      <span className={cn("font-mono text-sm font-medium tabular-nums", stat.color)}>
                        {stat.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setCoverageExpanded((current) => !current)}
              className="flex w-full items-center justify-between rounded-lg border border-[#1E4560] bg-[#123049] px-4 py-3 text-left transition-colors hover:border-[#FF6B1A]/30"
              aria-expanded={coverageExpanded}
            >
              <span className="flex items-center gap-2 font-mono text-xs text-[#86ADC2]">
                <Layers className="h-3.5 w-3.5 text-[#4F7590]" aria-hidden />
                Repository coverage breakdown
              </span>
              {coverageExpanded ? (
                <ChevronUp className="h-4 w-4 text-[#4F7590]" aria-hidden />
              ) : (
                <ChevronDown className="h-4 w-4 text-[#4F7590]" aria-hidden />
              )}
            </button>
            {coverageExpanded && (
              <div className="mt-2 overflow-hidden rounded-lg border border-[#1E4560] bg-[#123049]">
                <CoverageMatrix coverage={report.coverage} />
              </div>
            )}
          </div>
        </section>

        <div className="flex flex-col lg:flex-row">
          {!singleClaim && (
          <aside className="shrink-0 border-b border-[#1E4560] lg:w-[320px] lg:border-b-0 lg:border-r lg:sticky lg:top-0 lg:self-start xl:w-[360px]">
            <div className="border-b border-[#1E4560] px-4 py-3">
              <SectionEyebrow>Claims</SectionEyebrow>
              <div className="mt-2 flex flex-wrap gap-1">
                {VERDICT_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setVerdictFilter(option.value)}
                    className={cn(
                      "rounded px-2 py-1 font-mono text-[10px] transition-colors",
                      verdictFilter === option.value
                        ? "bg-[#1E4560] text-[#FF6B1A]"
                        : "text-[#4F7590] hover:bg-[#123049] hover:text-[#86ADC2]"
                    )}
                    aria-pressed={verdictFilter === option.value}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[40vh] overflow-y-auto lg:max-h-[calc(100vh-3rem)]">
              {filteredClaims.map((claim) => (
                <ClaimRow
                  key={claim.id}
                  claim={claim}
                  selected={claim.id === selectedClaimId}
                  onSelect={() => selectClaim(claim.id)}
                  viewMode={viewMode}
                />
              ))}
              {filteredClaims.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-[#4F7590]">No claims match this filter.</p>
              )}
            </div>
          </aside>
          )}

          <main className="min-w-0 flex-1">
            {selectedClaim && judgment ? (
              <div className="mx-auto max-w-4xl p-5 pb-16 lg:p-6 lg:pb-20">
                {!singleClaim && (
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <SectionEyebrow>Selected claim</SectionEyebrow>
                    <p className="mt-1 text-sm leading-relaxed text-[#E9F3F8]">
                      {selectedClaim.normalizedInterpretation}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedClaim.verdict && <VerdictBadge verdict={selectedClaim.verdict} />}
                    {selectedClaim.confidence && (
                      <ConfidenceIndicator confidence={selectedClaim.confidence} showLabel />
                    )}
                  </div>
                </div>
                )}

                <DetailTabBar
                  active={detailTab}
                  onChange={setDetailTab}
                  evidenceCount={claimEvidence.length}
                  reviewCount={reviewItemCount}
                />

                {detailTab === "overview" && (
                  <div role="tabpanel" id="report-panel-overview" aria-labelledby="report-tab-overview">
                  <OverviewPanel
                    claim={selectedClaim}
                    judgment={judgment}
                    proofObligations={claimProofObligation}
                    viewMode={viewMode}
                  />
                  </div>
                )}

                {detailTab === "evidence" && (
                  <div role="tabpanel" id="report-panel-evidence" aria-labelledby="report-tab-evidence">
                  <EvidencePanel evidence={claimEvidence} viewMode={viewMode} />
                  </div>
                )}

                {detailTab === "review" && (
                  <div role="tabpanel" id="report-panel-review" aria-labelledby="report-tab-review">
                  <ReviewPanel
                    challenges={claimChallenges}
                    evidenceGaps={claimGaps}
                    maintainerActions={claimMaintainerActions}
                    viewMode={viewMode}
                  />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-8">
                <p className="text-sm text-[#4F7590]">Select a claim to inspect its evidence case.</p>
              </div>
            )}
          </main>
        </div>
      </div>
    </AppShell>
  );
}

function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded border border-[#1E4560]">
      <button
        onClick={() => onChange("reviewer")}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[10px] transition-colors",
          viewMode === "reviewer" ? "bg-[#1E4560] text-[#FF6B1A]" : "bg-[#0D2436] text-[#4F7590] hover:text-[#86ADC2]"
        )}
        aria-pressed={viewMode === "reviewer"}
      >
        <Eye className="h-3 w-3" aria-hidden />
        Reviewer
      </button>
      <button
        onClick={() => onChange("maintainer")}
        className={cn(
          "flex items-center gap-1.5 border-l border-[#1E4560] px-2.5 py-1.5 font-mono text-[10px] transition-colors",
          viewMode === "maintainer" ? "bg-[#1E4560] text-[#FF6B1A]" : "bg-[#0D2436] text-[#4F7590] hover:text-[#86ADC2]"
        )}
        aria-pressed={viewMode === "maintainer"}
      >
        <Wrench className="h-3 w-3" aria-hidden />
        Maintainer
      </button>
    </div>
  );
}

function MetaTile({
  icon: Icon,
  label,
  value,
  accent = false,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: boolean;
  href?: string;
}) {
  const content = (
    <p className={cn("mt-1 truncate font-mono text-xs", accent ? "text-[#FF6B1A]" : "text-[#E9F3F8]")}>
      {value}
    </p>
  );

  return (
    <div className="rounded-lg border border-[#1E4560] bg-[#0D2436] px-3 py-2.5">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
        <Icon className="h-3 w-3" aria-hidden />
        {label}
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="mt-1 block truncate font-mono text-xs text-[#FF6B1A] hover:underline">
          {value}
        </a>
      ) : (
        content
      )}
    </div>
  );
}

function VerdictHero({
  claim,
  judgment,
  disposition,
}: {
  claim: Claim;
  judgment: NonNullable<Report["judgments"][string]>;
  disposition?: Report["completionDisposition"];
}) {
  return (
    <div className="rounded-xl border border-[#1E4560] bg-[#123049] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <SectionEyebrow>Primary outcome</SectionEyebrow>
          <p className="mt-2 text-sm leading-relaxed text-[#86ADC2]">{claim.normalizedInterpretation}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {claim.verdict && <VerdictBadge verdict={claim.verdict} />}
          {claim.confidence && <ConfidenceIndicator confidence={claim.confidence} showLabel />}
        </div>
      </div>
      <p className="mt-4 text-lg font-medium leading-relaxed text-[#E9F3F8]">{judgment.summary}</p>
      {disposition && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-[#86ADC2]">
          Investigation disposition: {disposition.replaceAll("_", " ")}
        </p>
      )}
    </div>
  );
}

function ProvenanceBar({ report }: { report: Report }) {
  if (!report.artifactHashSha256 && !report.snapshotManifestHash) return null;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {report.snapshotManifestHash && (
        <span className="rounded border border-[#1E4560] bg-[#0D2436] px-2.5 py-1 font-mono text-[10px] text-[#86ADC2]">
          Snapshot manifest {truncateHash(report.snapshotManifestHash)}
        </span>
      )}
      {report.artifactHashSha256 && (
        <span className="rounded border border-[#1E4560] bg-[#0D2436] px-2.5 py-1 font-mono text-[10px] text-[#86ADC2]">
          Report artifact {truncateHash(report.artifactHashSha256)}
        </span>
      )}
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">{children}</p>
  );
}

function DetailTabBar({
  active,
  onChange,
  evidenceCount,
  reviewCount,
}: {
  active: DetailTab;
  onChange: (tab: DetailTab) => void;
  evidenceCount: number;
  reviewCount: number;
}) {
  const tabs: { id: DetailTab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: "overview", label: "Overview", icon: ClipboardList },
    { id: "evidence", label: "Evidence", icon: Search, count: evidenceCount },
    { id: "review", label: "Review", icon: ShieldAlert, count: reviewCount },
  ];

  return (
    <div className="mb-6 flex flex-wrap gap-2 border-b border-[#1E4560] pb-3" role="tablist" aria-label="Claim detail sections">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`report-tab-${tab.id}`}
            aria-controls={`report-panel-${tab.id}`}
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-mono text-xs transition-colors",
              isActive
                ? "bg-[#1E4560] text-[#FF6B1A]"
                : "text-[#86ADC2] hover:bg-[#123049] hover:text-[#E9F3F8]"
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {tab.label}
            {typeof tab.count === "number" && (
              <span className={cn("rounded px-1.5 py-0.5 text-[10px]", isActive ? "bg-[#123049]" : "bg-[#1E4560]")}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

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
        "w-full border-b border-[#1E4560] px-4 py-4 text-left transition-colors last:border-b-0",
        selected ? "bg-[#1E4560]" : "hover:bg-[#123049]"
      )}
      aria-pressed={selected}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={cn("line-clamp-3 text-sm leading-relaxed", selected ? "text-[#E9F3F8]" : "text-[#86ADC2]")}>
            {claim.normalizedInterpretation}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {claim.verdict && <VerdictBadge verdict={claim.verdict} size="sm" />}
            <span className={cn("font-mono text-[10px]", critConfig.color)}>{critConfig.label}</span>
            {viewMode === "maintainer" && claim.openLimitations > 0 && (
              <span className="font-mono text-[10px] text-[#FFC94D]">
                {claim.openLimitations} limitation{claim.openLimitations !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
        <ChevronRight
          className={cn("mt-1 h-4 w-4 shrink-0", selected ? "text-[#FF6B1A]" : "text-[#4F7590]")}
          aria-hidden
        />
      </div>
    </button>
  );
}

function OverviewPanel({
  claim,
  judgment,
  proofObligations,
  viewMode,
}: {
  claim: Claim;
  judgment: NonNullable<Report["judgments"][string]>;
  proofObligations: NonNullable<Report["proofObligations"][string]>;
  viewMode: ViewMode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Claim definition">
        <p className="text-sm leading-relaxed text-[#E9F3F8]">{claim.originalStatement}</p>
        {claim.originalStatement !== claim.normalizedInterpretation && (
          <p className="mt-3 text-sm leading-relaxed text-[#86ADC2]">{claim.normalizedInterpretation}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Tag>{CATEGORY_LABELS[claim.category]}</Tag>
          <Tag className={CRITICALITY_CONFIG[claim.criticality].color}>
            {CRITICALITY_CONFIG[claim.criticality].label}
          </Tag>
        </div>
        {claim.preservedQualifiers.length > 0 && (
          <div className="mt-4 border-t border-[#1E4560] pt-4">
            <SectionEyebrow>Preserved qualifiers</SectionEyebrow>
            <div className="mt-2 flex flex-wrap gap-2">
              {claim.preservedQualifiers.map((qualifier) => (
                <span
                  key={qualifier}
                  className="rounded bg-[#1E4560] px-2 py-1 font-mono text-[10px] text-[#FF8540]"
                >
                  {qualifier}
                </span>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Verdict">
        <p className="text-base font-medium leading-relaxed text-[#E9F3F8]">{judgment.summary}</p>
        <p className="mt-3 text-sm leading-relaxed text-[#86ADC2]">{judgment.reasoning}</p>

        {judgment.unprovenAspects.length > 0 && (
          <div className="mt-5 border-t border-[#1E4560] pt-4">
            <SectionEyebrow>What remains unproven</SectionEyebrow>
            <ul className="mt-2 flex flex-col gap-2">
              {judgment.unprovenAspects.map((aspect, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-[#FFC94D]">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#FFC94D]" aria-hidden />
                  {aspect}
                </li>
              ))}
            </ul>
          </div>
        )}

        {judgment.whatCouldChangeVerdict.length > 0 && viewMode === "maintainer" && (
          <div className="mt-5 border-t border-[#1E4560] pt-4">
            <SectionEyebrow>What could change this verdict</SectionEyebrow>
            <ul className="mt-2 flex flex-col gap-2">
              {judgment.whatCouldChangeVerdict.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-[#86ADC2]">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#FF6B1A]" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {judgment.confidenceFactors && judgment.confidenceFactors.length > 0 && (
          <div className="mt-5 border-t border-[#1E4560] pt-4">
            <SectionEyebrow>Confidence factors</SectionEyebrow>
            <ul className="mt-2 flex flex-col gap-2">
              {judgment.confidenceFactors.map((factor, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-[#86ADC2]">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#4FBF9A]" aria-hidden />
                  {factor}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      {proofObligations.length > 0 && (
        <Panel title="Proof obligations">
          <ProofObligationList obligations={proofObligations} />
        </Panel>
      )}
    </div>
  );
}

function EvidencePanel({ evidence, viewMode }: { evidence: Evidence[]; viewMode: ViewMode }) {
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(null);

  if (evidence.length === 0) {
    return (
      <EmptyPanel
        title="No evidence recorded"
        description="This claim does not have persisted evidence items in the report artifact."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {evidence.map((item) => (
        <EvidenceItem
          key={item.id}
          evidence={item}
          expanded={expandedEvidenceId === item.id}
          onToggle={() => setExpandedEvidenceId((current) => (current === item.id ? null : item.id))}
          viewMode={viewMode}
        />
      ))}
    </div>
  );
}

function ReviewPanel({
  challenges,
  evidenceGaps,
  maintainerActions,
  viewMode,
}: {
  challenges: NonNullable<Report["challenges"][string]>;
  evidenceGaps: NonNullable<Report["evidenceGaps"][string]>;
  maintainerActions: string[];
  viewMode: ViewMode;
}) {
  const hasContent = challenges.length > 0 || evidenceGaps.length > 0 || maintainerActions.length > 0;

  if (!hasContent) {
    return (
      <EmptyPanel
        title="No review items"
        description="No skeptic challenges, limitations, or maintainer actions were recorded for this claim."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {challenges.length > 0 && (
        <Panel title="Skeptic challenges">
          <div className="flex flex-col gap-3">
            {challenges.map((challenge) => (
              <div key={challenge.id} className="rounded-lg border border-[#FFC94D]/25 bg-[#123049] p-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#FFC94D]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-[#FFC94D]">
                        {AGENT_ROLE_LABELS[challenge.challengingAgent] ?? challenge.challengingAgent}
                      </span>
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                          challenge.severity === "critical"
                            ? "border-[#F2796B]/30 text-[#F2796B]"
                            : challenge.severity === "major"
                              ? "border-[#FFC94D]/30 text-[#FFC94D]"
                              : "border-[#86ADC2]/30 text-[#86ADC2]"
                        )}
                      >
                        {challenge.severity}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-[#E9F3F8]">{challenge.challengeText}</p>
                    {challenge.resolution && (
                      <div className="mt-4 rounded-lg border border-[#1E4560] bg-[#0D2436] p-3">
                        <SectionEyebrow>Resolution</SectionEyebrow>
                        <p className="mt-2 text-sm leading-relaxed text-[#86ADC2]">{challenge.resolution}</p>
                        {challenge.verdictChanged && challenge.verdictBefore && challenge.verdictAfter && (
                          <div className="mt-3 flex items-center gap-2">
                            <VerdictBadge verdict={challenge.verdictBefore} size="sm" />
                            <ChevronRight className="h-3 w-3 text-[#4F7590]" aria-hidden />
                            <VerdictBadge verdict={challenge.verdictAfter} size="sm" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {evidenceGaps.length > 0 && (
        <Panel title="Limitations">
          <div className="flex flex-col gap-3">
            {evidenceGaps.map((gap) => (
              <div key={gap.id} className="rounded-lg border border-[#1E4560] bg-[#123049] p-4">
                <p className="text-sm font-medium text-[#E9F3F8]">{gap.description}</p>
                <p className="mt-2 text-sm text-[#86ADC2]">{gap.unavailableReason}</p>
                <p className="mt-2 text-sm text-[#FFC94D]">{gap.impactOnVerdict}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {maintainerActions.length > 0 && viewMode === "maintainer" && (
        <Panel title="Maintainer actions">
          <ol className="flex flex-col gap-3">
            {maintainerActions.map((action, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1E4560] font-mono text-[10px] text-[#FF6B1A]">
                  {index + 1}
                </span>
                <p className="text-sm leading-relaxed text-[#86ADC2]">{action}</p>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#1E4560] bg-[#123049] p-5">
      <h2 className="font-mono text-xs uppercase tracking-wider text-[#4F7590]">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#1E4560] bg-[#123049]/50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-[#E9F3F8]">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[#86ADC2]">{description}</p>
    </div>
  );
}

function EvidenceItem({
  evidence,
  expanded,
  onToggle,
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
    <article className="overflow-hidden rounded-xl border border-[#1E4560] bg-[#123049]">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-[#1E4560] px-2 py-0.5 font-mono text-[10px] text-[#86ADC2]">
                {EVIDENCE_TYPE_LABELS[evidence.type] ?? evidence.type}
              </span>
              <span className={cn("font-mono text-[10px] font-medium", strengthCfg.color)}>{strengthCfg.label}</span>
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
            <p className="mt-3 text-sm leading-relaxed text-[#E9F3F8]">{evidence.observation}</p>
            <p className="mt-2 text-sm leading-relaxed text-[#86ADC2]">{evidence.relevance}</p>
          </div>

          <button
            onClick={onToggle}
            className="shrink-0 rounded p-1.5 text-[#4F7590] transition-colors hover:bg-[#1E4560] hover:text-[#86ADC2]"
            aria-label={expanded ? "Collapse evidence" : "Expand evidence"}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[#1E4560] pt-3">
          {evidence.repositoryPath && (
            <span className="font-mono text-[10px] text-[#4F7590]">{evidence.repositoryPath}</span>
          )}
          {evidence.lineStart && (
            <span className="font-mono text-[10px] text-[#4F7590]">
              L{evidence.lineStart}
              {evidence.lineEnd && evidence.lineEnd !== evidence.lineStart ? `–${evidence.lineEnd}` : ""}
            </span>
          )}
          {evidence.commitSha && (
            <button
              className="flex items-center gap-1 font-mono text-[10px] text-[#FF6B1A] hover:underline"
              onClick={(event) => {
                event.stopPropagation();
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
            {truncateHash(evidence.id)}
            {copiedId ? <Check className="h-3 w-3 text-[#4FBF9A]" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
          </button>
        </div>
      </div>

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
    </article>
  );
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "rounded border border-[#1E4560] px-2 py-0.5 font-mono text-[10px] text-[#86ADC2]",
        className
      )}
    >
      {children}
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { cn } from "@/lib/utils";
import {
  getInvestigation,
  getStorageHealth,
  saveClaims,
  saveSelectedClaims,
} from "@/lib/investigation-repository";
import type { Claim, ClaimCategory, Criticality, Investigation } from "@/lib/types";
import {
  CheckSquare,
  Square,
  Edit3,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Loader2,
  Users,
  Clock,
  GitCommitHorizontal,
  AlertTriangle,
} from "lucide-react";

const MAX_SELECTED = 5;

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
  { label: string; color: string; border: string }
> = {
  critical: { label: "Critical", color: "text-[#F2796B]", border: "border-[#F2796B]/30" },
  high: { label: "High", color: "text-[#FFC94D]", border: "border-[#FFC94D]/30" },
  medium: { label: "Medium", color: "text-[#FF6B1A]", border: "border-[#FF6B1A]/30" },
  low: { label: "Low", color: "text-[#86ADC2]", border: "border-[#86ADC2]/30" },
};

const AGENT_NAMES = [
  "Claim Analyst",
  "Investigation Planner",
  "Repository Investigator",
  "Skeptic Agent",
  "Evidence Judge",
];

interface EditState {
  interpretation: string;
  criticality: Criticality;
}

export function ClaimsClient({ id }: { id: string }) {
  const router = useRouter();
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageMessage, setStorageMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditState | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [beginning, setBeginning] = useState(false);

  useEffect(() => {
    const loaded = getInvestigation(id);
    setInvestigation(loaded);
    setClaims(loaded?.claims ?? []);
    const health = getStorageHealth();
    setStorageMessage(health.status === "available" ? "" : health.message);
    setLoading(false);
  }, [id]);

  const selected = claims.filter((claim) => claim.selected);
  const selectedCount = selected.length;
  const atMax = selectedCount >= MAX_SELECTED;

  function persist(nextClaims: Claim[]) {
    setClaims(nextClaims);
    const next = saveClaims(id, nextClaims);
    if (next) setInvestigation(next);
    const health = getStorageHealth();
    setStorageMessage(health.status === "available" ? "" : health.message);
  }

  function toggleSelect(claimId: string) {
    const nextClaims = claims.map((claim) => {
      if (claim.id !== claimId) return claim;
      if (claim.selected) return { ...claim, selected: false };
      if (atMax) return claim;
      return { ...claim, selected: true };
    });
    saveSelectedClaims(id, nextClaims);
    persist(nextClaims);
  }

  function startEdit(claim: Claim) {
    setEditingId(claim.id);
    setEditDraft({
      interpretation: claim.normalizedInterpretation,
      criticality: claim.criticality,
    });
  }

  function commitEdit(claimId: string) {
    if (!editDraft) return;
    const nextClaims = claims.map((claim) =>
      claim.id === claimId
        ? {
            ...claim,
            normalizedInterpretation: editDraft.interpretation,
            criticality: editDraft.criticality,
          }
        : claim
    );
    persist(nextClaims);
    setEditingId(null);
    setEditDraft(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  function selectRecommended() {
    const critical = claims.filter((claim) => claim.criticality === "critical");
    const high = claims.filter(
      (claim) =>
        claim.criticality === "high" &&
        !critical.some((criticalClaim) => criticalClaim.id === claim.id)
    );
    const pool = [...critical, ...high].slice(0, MAX_SELECTED);
    persist(
      claims.map((claim) => ({
        ...claim,
        selected: pool.some((poolClaim) => poolClaim.id === claim.id),
      }))
    );
  }

  async function beginInvestigation() {
    setBeginning(true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    router.push(`/investigations/${id}/live`);
  }

  if (loading) {
    return (
      <AppShell title="Review claims">
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
    return (
      <AppShell title="Review claims">
        <div className="mx-auto max-w-xl p-6">
          <div className="rounded border border-[#F2796B]/30 bg-[#3A1414] p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F2796B]" aria-hidden />
              <div>
                <h1 className="text-sm font-semibold text-[#E9F3F8]">Investigation not found</h1>
                <p className="mt-1 text-sm text-[#86ADC2]">
                  No persisted investigation exists for {id}. Start a new investigation to review claims.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Review claims" investigation={investigation}>
      <div className="flex h-full flex-col lg:flex-row">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="border-b border-[#1E4560] px-6 py-5">
            <h1 className="text-lg font-semibold text-[#E9F3F8]">
              Cernix extracted {claims.length} technical claims
            </h1>
            <p className="mt-1 text-sm text-[#86ADC2]">
              Review the interpretation before the investigation begins. Select up to {MAX_SELECTED} claims for this investigation.
            </p>
            {storageMessage && (
              <p className="mt-3 rounded border border-[#FFC94D]/30 bg-[#3A2A0E] px-3 py-2 font-mono text-xs text-[#FFC94D]" role="status">
                {storageMessage}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={selectRecommended}
                className="rounded border border-[#FF6B1A]/40 bg-[#FF6B1A]/10 px-3 py-1 font-mono text-xs text-[#FF6B1A] transition-colors hover:bg-[#FF6B1A]/20"
              >
                Select recommended
              </button>
              {atMax && (
                <span className="font-mono text-xs text-[#FFC94D]">
                  Maximum {MAX_SELECTED} claims selected
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 p-4">
            {claims.map((claim) => {
              const isEditing = editingId === claim.id;
              const isExpanded = expandedId === claim.id;
              const critConfig = CRITICALITY_CONFIG[claim.criticality];

              return (
                <div
                  key={claim.id}
                  className={cn(
                    "rounded border bg-[#123049] transition-all",
                    claim.selected ? "border-[#FF6B1A]/50" : "border-[#1E4560]"
                  )}
                >
                  <div className="flex items-start gap-3 p-4">
                    <button
                      onClick={() => toggleSelect(claim.id)}
                      disabled={!claim.selected && atMax}
                      className={cn(
                        "mt-0.5 shrink-0 rounded p-0.5 transition-colors",
                        claim.selected
                          ? "text-[#FF6B1A]"
                          : atMax
                          ? "cursor-not-allowed text-[#4F7590]"
                          : "text-[#4F7590] hover:text-[#86ADC2]"
                      )}
                      aria-label={claim.selected ? "Deselect claim" : "Select claim"}
                    >
                      {claim.selected ? <CheckSquare className="h-4 w-4" aria-hidden /> : <Square className="h-4 w-4" aria-hidden />}
                    </button>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[#E9F3F8]">{claim.originalStatement}</p>

                      {isEditing && editDraft ? (
                        <div className="mt-2 flex flex-col gap-2">
                          <textarea
                            value={editDraft.interpretation}
                            onChange={(event) =>
                              setEditDraft((draft) =>
                                draft ? { ...draft, interpretation: event.target.value } : draft
                              )
                            }
                            rows={3}
                            className="w-full resize-y rounded border border-[#FF6B1A]/50 bg-[#082031] px-3 py-2 text-xs leading-relaxed text-[#E9F3F8] outline-none"
                            aria-label="Edit interpretation"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="font-mono text-[10px] text-[#4F7590]">Criticality:</label>
                            <select
                              value={editDraft.criticality}
                              onChange={(event) =>
                                setEditDraft((draft) =>
                                  draft
                                    ? { ...draft, criticality: event.target.value as Criticality }
                                    : draft
                                )
                              }
                              className="rounded border border-[#1E4560] bg-[#082031] px-2 py-0.5 font-mono text-xs text-[#E9F3F8]"
                            >
                              {(["critical", "high", "medium", "low"] as Criticality[]).map((criticality) => (
                                <option key={criticality} value={criticality}>
                                  {CRITICALITY_CONFIG[criticality].label}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => commitEdit(claim.id)}
                              className="flex items-center gap-1 rounded bg-[#FF6B1A] px-2 py-0.5 font-mono text-[10px] text-[#0B1E2E]"
                            >
                              <Check className="h-3 w-3" aria-hidden />
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="flex items-center gap-1 rounded border border-[#1E4560] px-2 py-0.5 font-mono text-[10px] text-[#86ADC2]"
                            >
                              <X className="h-3 w-3" aria-hidden />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-xs leading-relaxed text-[#86ADC2]">
                          {claim.normalizedInterpretation}
                        </p>
                      )}

                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", critConfig.color, critConfig.border)}>
                          {critConfig.label}
                        </span>
                        <span className="rounded border border-[#1E4560] px-1.5 py-0.5 font-mono text-[10px] text-[#86ADC2]">
                          {CATEGORY_LABELS[claim.category]}
                        </span>
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                            claim.verifiability === "verifiable"
                              ? "border-[#4FBF9A]/30 text-[#4FBF9A]"
                              : claim.verifiability === "partially_verifiable"
                              ? "border-[#FFC94D]/30 text-[#FFC94D]"
                              : "border-[#86ADC2]/30 text-[#86ADC2]"
                          )}
                        >
                          {claim.verifiability === "verifiable"
                            ? "Verifiable"
                            : claim.verifiability === "partially_verifiable"
                            ? "Partially verifiable"
                            : "Not verifiable"}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {!isEditing && (
                        <button
                          onClick={() => startEdit(claim)}
                          className="rounded p-1.5 text-[#4F7590] transition-colors hover:bg-[#1E4560] hover:text-[#86ADC2]"
                          aria-label="Edit interpretation"
                        >
                          <Edit3 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                      <button
                        onClick={() => setExpandedId((previous) => (previous === claim.id ? null : claim.id))}
                        className="rounded p-1.5 text-[#4F7590] transition-colors hover:bg-[#1E4560] hover:text-[#86ADC2]"
                        aria-label={isExpanded ? "Collapse details" : "Expand details"}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-[#1E4560] px-4 py-3">
                      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
                        Preserved qualifiers
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {claim.preservedQualifiers.map((qualifier) => (
                          <span key={qualifier} className="rounded bg-[#1E4560] px-2 py-0.5 font-mono text-[10px] text-[#FF8540]">
                            {qualifier}
                          </span>
                        ))}
                      </div>
                      {claim.parentId && (
                        <p className="mt-2 font-mono text-[10px] text-[#4F7590]">
                          Sub-claim of: <span className="text-[#86ADC2]">{claim.parentId}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="shrink-0 border-t border-[#1E4560] bg-[#123049] p-5 lg:w-72 lg:border-l lg:border-t-0 lg:overflow-y-auto">
          <h2 className="mb-4 font-mono text-xs uppercase tracking-wider text-[#4F7590]">
            Investigation summary
          </h2>

          <div className="mb-4 rounded border border-[#1E4560] p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-xs text-[#86ADC2]">Selected</span>
              <span className={cn("font-mono text-xl font-semibold tabular-nums", selectedCount === MAX_SELECTED ? "text-[#FFC94D]" : "text-[#E9F3F8]")}> 
                {selectedCount}<span className="text-sm text-[#4F7590]"> / {MAX_SELECTED}</span>
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#1E4560]">
              <div className={cn("h-full rounded-full transition-all", selectedCount === MAX_SELECTED ? "bg-[#FFC94D]" : "bg-[#FF6B1A]")} style={{ width: `${(selectedCount / MAX_SELECTED) * 100}%` }} />
            </div>
          </div>

          {selected.length > 0 && (
            <div className="mb-4 flex flex-col gap-1.5">
              {selected.map((claim) => (
                <div key={claim.id} className="flex items-start gap-2 rounded border border-[#1E4560] bg-[#1E4560] px-2.5 py-2">
                  <CheckSquare className="mt-0.5 h-3 w-3 shrink-0 text-[#FF6B1A]" aria-hidden />
                  <p className="line-clamp-2 text-[11px] leading-snug text-[#E9F3F8]">
                    {claim.originalStatement.replace(/^"|"$/g, "")}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="mb-4 flex flex-col gap-1.5 rounded border border-[#1E4560] p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">
              Repository snapshot
            </p>
            <p className="font-mono text-xs text-[#E9F3F8]">
              {investigation.repositorySnapshot.owner}/{investigation.repositorySnapshot.repo}
            </p>
            <div className="flex items-center gap-1 font-mono text-[10px] text-[#86ADC2]">
              <GitCommitHorizontal className="h-3 w-3" aria-hidden />
              {investigation.repositorySnapshot.commitSha.slice(0, 7)}
            </div>
          </div>

          <div className="mb-4 flex items-center gap-2 rounded border border-[#1E4560] p-3">
            <Clock className="h-3.5 w-3.5 shrink-0 text-[#4F7590]" aria-hidden />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">Estimated time</p>
              <p className="font-mono text-xs text-[#E9F3F8]">
                {selectedCount <= 2 ? "3-5 min" : selectedCount <= 4 ? "5-8 min" : "8-12 min"}
              </p>
            </div>
          </div>

          <div className="mb-5 flex flex-col gap-1.5 rounded border border-[#1E4560] p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[#4F7590]">Agents</p>
            {AGENT_NAMES.map((name) => (
              <div key={name} className="flex items-center gap-1.5 font-mono text-[10px] text-[#86ADC2]">
                <Users className="h-3 w-3 text-[#4F7590]" aria-hidden />
                {name}
              </div>
            ))}
          </div>

          <button
            onClick={beginInvestigation}
            disabled={selectedCount === 0 || beginning}
            className="flex w-full items-center justify-center gap-2 rounded bg-[#FF6B1A] px-4 py-2.5 text-sm font-medium text-[#0B1E2E] transition-colors hover:bg-[#FF8540] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {beginning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Starting...
              </>
            ) : (
              "Begin investigation"
            )}
          </button>
          {selectedCount === 0 && (
            <p className="mt-2 text-center font-mono text-[10px] text-[#4F7590]">
              Select at least one claim to continue.
            </p>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import {
  ApiRequestError,
  approveClaim,
  getInvestigation,
  startInvestigation,
} from "@/lib/api/investigation-client";
import { investigationResponseToUi } from "@/lib/api/backend-investigation-adapter";
import type { InvestigationResponse } from "@/lib/contracts/investigation-api";
import { AlertTriangle, Loader2 } from "lucide-react";

export function BackendClaimsClient({ id }: { id: string }) {
  const router = useRouter();
  const [investigation, setInvestigation] = useState<InvestigationResponse | null>(null);
  const [statement, setStatement] = useState("");
  const [qualifiers, setQualifiers] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getInvestigation(id);
        if (cancelled) return;
        setInvestigation(loaded);
        setStatement(loaded.claim.statement);
        setQualifiers(loaded.claim.preservedQualifiers.join(", "));
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

  async function handleApproveAndStart() {
    if (!investigation) return;
    setSubmitting(true);
    setError("");
    try {
      const preservedQualifiers = qualifiers.split(",").map((value) => value.trim()).filter(Boolean);
      const approved = await approveClaim(id, { statement: statement.trim(), preservedQualifiers, approved: true as const });
      setInvestigation(approved);
      await startInvestigation(id, crypto.randomUUID());
      router.push(`/investigations/${id}/live`);
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : "Unable to start investigation.");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Review claim">
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
      <AppShell title="Review claim">
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
  const editable = investigation.status === "awaiting_claim_review";

  return (
    <AppShell title="Review claim" investigation={ui}>
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-[#E9F3F8]">Review claim</h1>
          <p className="mt-1 text-sm text-[#86ADC2]">
            Confirm the claim statement for {investigation.repository.owner}/{investigation.repository.name} before the backend investigation starts.
          </p>
        </div>

        {error && (
          <p className="mb-4 rounded border border-[#F2796B]/30 bg-[#3A1414] px-3 py-2 font-mono text-xs text-[#F2796B]" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-4 rounded-lg border border-[#1E4560] bg-[#123049] p-5">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-[#86ADC2]">Claim statement</span>
            <textarea
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
              disabled={!editable || submitting}
              rows={5}
              className="w-full resize-y rounded-lg border border-[#1E4560] bg-[#082031] px-3 py-2 text-sm text-[#E9F3F8] outline-none focus:border-[#FF6B1A] disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-xs text-[#86ADC2]">Preserved qualifiers</span>
            <input
              value={qualifiers}
              onChange={(event) => setQualifiers(event.target.value)}
              disabled={!editable || submitting}
              placeholder="comma-separated qualifiers"
              className="w-full rounded-lg border border-[#1E4560] bg-[#082031] px-3 py-2 text-sm text-[#E9F3F8] outline-none focus:border-[#FF6B1A] disabled:opacity-60"
            />
          </label>
        </div>

        <div className="mt-6 flex items-center gap-3">
          {editable ? (
            <button
              type="button"
              onClick={handleApproveAndStart}
              disabled={submitting || statement.trim().length === 0}
              className="flex items-center gap-2 rounded-lg bg-[#FF6B1A] px-5 py-2.5 text-sm font-medium text-[#0B1E2E] transition-colors hover:bg-[#FF8540] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Approve claim and start
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.push(`/investigations/${id}/live`)}
              className="rounded-lg border border-[#1E4560] bg-[#123049] px-5 py-2.5 text-sm text-[#E9F3F8] hover:border-[#FF6B1A]/50"
            >
              Open live investigation
            </button>
          )}
          <span className="font-mono text-xs text-[#4F7590]">Status: {investigation.status}</span>
        </div>
      </div>
    </AppShell>
  );
}

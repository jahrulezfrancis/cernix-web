"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { ReportClient } from "./report-client";
import {
  ApiRequestError,
  getInvestigation,
  getInvestigationReport,
} from "@/lib/api/investigation-client";
import { investigationResponseToUi, judgeArtifactToReport } from "@/lib/api/backend-investigation-adapter";
import type { Investigation, Report } from "@/lib/types";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";

export function ReportPageClient({ id }: { id: string }) {
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [loaded, persisted] = await Promise.all([
          getInvestigation(id),
          getInvestigationReport(id),
        ]);
        if (cancelled) return;
        const ui = investigationResponseToUi(loaded, { hasReport: true });
        setInvestigation(ui);
        setReport(judgeArtifactToReport(loaded, persisted));
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof ApiRequestError ? cause.message : "Unable to load report.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <AppShell title="Evidence report">
        <div className="flex h-full items-center justify-center p-6">
          <div className="flex items-center gap-2 font-mono text-xs text-[#86ADC2]">
            <Loader2 className="h-4 w-4 animate-spin text-[#FF6B1A]" aria-hidden />
            Loading report...
          </div>
        </div>
      </AppShell>
    );
  }

  if (!investigation) {
    return (
      <AppShell title="Evidence report">
        <StateCard
          tone="error"
          title="Investigation not found"
          message={error || `No investigation exists for ${id}.`}
        />
      </AppShell>
    );
  }

  const completed = investigation.status === "completed" || investigation.status === "completed_with_limitations";
  if (!completed || !report) {
    return (
      <AppShell title="Evidence report" investigation={investigation}>
        <StateCard
          tone="warning"
          title="Report not ready"
          message={error || "This investigation has not completed yet. Open the live investigation to monitor progress."}
          actionHref={`/investigations/${id}/live`}
          actionLabel="Open live investigation"
        />
      </AppShell>
    );
  }

  return (
    <ReportClient
      report={report}
      investigationId={id}
      investigation={investigation}
    />
  );
}

function StateCard({
  title,
  message,
  tone,
  actionHref,
  actionLabel,
}: {
  title: string;
  message: string;
  tone: "error" | "warning";
  actionHref?: string;
  actionLabel?: string;
}) {
  const isError = tone === "error";
  return (
    <div className="mx-auto max-w-xl p-6">
      <div className={`${isError ? "border-[#F2796B]/30 bg-[#3A1414]" : "border-[#FFC94D]/30 bg-[#3A2A0E]"} rounded border p-4`}>
        <div className="flex items-start gap-3">
          {isError ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F2796B]" aria-hidden />
          ) : (
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#FFC94D]" aria-hidden />
          )}
          <div>
            <h1 className="text-sm font-semibold text-[#E9F3F8]">{title}</h1>
            <p className="mt-1 text-sm text-[#86ADC2]">{message}</p>
            {actionHref && actionLabel && (
              <Link href={actionHref} className="mt-4 inline-flex rounded bg-[#FF6B1A] px-3 py-2 text-sm font-medium text-[#0B1E2E]">
                {actionLabel}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

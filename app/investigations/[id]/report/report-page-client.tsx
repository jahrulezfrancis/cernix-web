"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { ReportClient } from "./report-client";
import { getInvestigation, getStorageHealth } from "@/lib/investigation-repository";
import type { Investigation } from "@/lib/types";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";

export function ReportPageClient({ id }: { id: string }) {
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageMessage, setStorageMessage] = useState("");

  useEffect(() => {
    const loaded = getInvestigation(id);
    setInvestigation(loaded);
    const health = getStorageHealth();
    setStorageMessage(health.status === "available" ? "" : health.message);
    setLoading(false);
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
          message={`No persisted investigation exists for ${id}. The app no longer falls back to the sample report for unknown IDs.`}
        />
      </AppShell>
    );
  }

  if (!investigation.report) {
    return (
      <AppShell title="Evidence report" investigation={investigation}>
        <StateCard
          tone="warning"
          title="Report not ready"
          message="This investigation has not completed yet. Finish the simulated live investigation before opening the evidence report."
          actionHref={`/investigations/${id}/live`}
          actionLabel="Open live investigation"
        />
        {storageMessage && (
          <p className="mx-auto mt-4 max-w-xl rounded border border-[#FFC94D]/30 bg-[#3A2A0E] px-3 py-2 font-mono text-xs text-[#FFC94D]" role="status">
            {storageMessage}
          </p>
        )}
      </AppShell>
    );
  }

  return (
    <ReportClient
      report={investigation.report}
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

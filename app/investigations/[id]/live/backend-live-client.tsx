"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import {
  ApiRequestError,
  getInvestigation,
  getInvestigationEvents,
} from "@/lib/api/investigation-client";
import { backendContinuationRoute, investigationResponseToUi } from "@/lib/api/backend-investigation-adapter";
import type { InvestigationEventResponse, InvestigationResponse } from "@/lib/contracts/investigation-api";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";

const TERMINAL = new Set(["completed", "completed_with_limitations", "failed"]);

export function BackendLiveClient({ id }: { id: string }) {
  const [investigation, setInvestigation] = useState<InvestigationResponse | null>(null);
  const [events, setEvents] = useState<InvestigationEventResponse[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  if (!investigation) {
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

  return (
    <AppShell title="Live investigation" investigation={ui}>
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#E9F3F8]">Live investigation</h1>
            <p className="mt-1 text-sm text-[#86ADC2]">
              Progress is derived from durable backend lifecycle events, not simulated percentages.
            </p>
          </div>
          {reportReady && (
            <Link href={reportHref} className="inline-flex items-center gap-1 rounded-lg border border-[#1E4560] bg-[#123049] px-3 py-2 font-mono text-xs text-[#86ADC2] hover:border-[#FF6B1A]/50 hover:text-[#E9F3F8]">
              Open report<ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </div>

        <div className="mb-6 rounded-lg border border-[#1E4560] bg-[#123049] p-4">
          <p className="font-mono text-xs text-[#4F7590]">Current status</p>
          <p className="mt-1 font-mono text-sm text-[#FF6B1A]">{investigation.status}</p>
        </div>

        <div className="rounded-lg border border-[#1E4560] bg-[#123049]">
          <div className="border-b border-[#1E4560] px-4 py-3 font-mono text-xs text-[#4F7590]">Event stream</div>
          <div className="max-h-[32rem] overflow-y-auto">
            {events.length === 0 ? (
              <p className="px-4 py-6 font-mono text-xs text-[#86ADC2]">Waiting for persisted events...</p>
            ) : (
              events.map((event) => (
                <div key={event.sequence} className="border-b border-[#1E4560] px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-[#4F7590]">
                    <span>#{event.sequence}</span>
                    <span>{event.type}</span>
                    <span>{event.stage}</span>
                    <span>{new Date(event.createdAt).toLocaleString()}</span>
                  </div>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-[#86ADC2]">
                    {JSON.stringify(event.publicPayload, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

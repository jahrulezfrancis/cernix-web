import { SAMPLE_REPORT } from "@/lib/sample-report-data";
import { ReportClient } from "@/app/investigations/[id]/report/report-client";

export const metadata = {
  title: "Sample Report — Cernix",
  description:
    "Illustrative sample evidence report for acme/stellar-service. Static demo data — not a live investigation.",
};

export default function SampleReportPage() {
  return (
    <div className="flex h-screen flex-col">
      <div className="shrink-0 border-b border-[#FFC94D]/30 bg-[#3A2A0E] px-4 py-2 text-center font-mono text-xs text-[#FFC94D]">
        Illustrative sample only — this report is static demo data and does not reflect a live backend investigation.
      </div>
      <div className="min-h-0 flex-1">
        <ReportClient report={SAMPLE_REPORT} investigationId="inv-sample" />
      </div>
    </div>
  );
}

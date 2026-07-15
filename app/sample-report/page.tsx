import { SAMPLE_REPORT } from "@/lib/mock-data";
import { ReportClient } from "@/app/investigations/[id]/report/report-client";

export const metadata = {
  title: "Sample Report — Cernix",
  description:
    "A fully populated sample evidence report for acme/stellar-service demonstrating the Cernix verification workflow.",
};

export default function SampleReportPage() {
  return (
    <div className="h-screen">
      <ReportClient report={SAMPLE_REPORT} investigationId="inv-sample" />
    </div>
  );
}

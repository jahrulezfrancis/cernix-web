import { cn } from "@/lib/utils";
import type { InvestigationCoverage, CoverageStatus } from "@/lib/types";
import { CheckCircle, CircleDashed, XCircle } from "lucide-react";

const STATUS_CONFIG: Record<CoverageStatus, { icon: React.ElementType; label: string; color: string }> = {
  complete: { icon: CheckCircle, label: "Complete", color: "text-[#4FBF9A]" },
  partial: { icon: CircleDashed, label: "Partial", color: "text-[#FFC94D]" },
  unavailable: { icon: XCircle, label: "Unavailable", color: "text-[#86ADC2]" },
};

const COVERAGE_LABELS: Record<keyof InvestigationCoverage, string> = {
  sourceCode: "Source code",
  documentation: "Documentation",
  tests: "Tests",
  ciWorkflows: "CI workflows",
  pullRequests: "Pull requests",
  branchProtection: "Branch protection",
  runtimeDeployment: "Runtime deployment",
  cloudRecords: "Cloud records",
};

interface CoverageMatrixProps {
  coverage: InvestigationCoverage;
  compact?: boolean;
  className?: string;
}

export function CoverageMatrix({ coverage, compact = false, className }: CoverageMatrixProps) {
  const keys = Object.keys(COVERAGE_LABELS) as Array<keyof InvestigationCoverage>;

  if (compact) {
    return (
      <div className={cn("flex flex-wrap gap-x-4 gap-y-1", className)}>
        {keys.map((key) => {
          const status = coverage[key];
          const config = STATUS_CONFIG[status];
          const Icon = config.icon;
          return (
            <span key={key} className={cn("flex items-center gap-1 font-mono text-[10px]", config.color)}>
              <Icon className="h-3 w-3" aria-hidden />
              <span className="text-[#86ADC2]">{COVERAGE_LABELS[key]}:</span>
              {config.label}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {keys.map((key, idx) => {
        const status = coverage[key];
        const config = STATUS_CONFIG[status];
        const Icon = config.icon;
        return (
          <div
            key={key}
            className={cn(
              "flex items-center justify-between px-3 py-2",
              idx !== 0 && "border-t border-[#1E4560]"
            )}
          >
            <span className="text-sm text-[#86ADC2]">{COVERAGE_LABELS[key]}</span>
            <span className={cn("flex items-center gap-1.5 font-mono text-xs", config.color)}>
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {config.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

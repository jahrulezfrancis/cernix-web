import { cn } from "@/lib/utils";
import type { Confidence } from "@/lib/types";

const CONFIG: Record<Confidence, { label: string; bars: number; color: string }> = {
  high: { label: "High confidence", bars: 3, color: "bg-[#4FBF9A]" },
  moderate: { label: "Moderate confidence", bars: 2, color: "bg-[#FFC94D]" },
  low: { label: "Low confidence", bars: 1, color: "bg-[#F2796B]" },
};

interface ConfidenceIndicatorProps {
  confidence: Confidence;
  showLabel?: boolean;
  className?: string;
}

export function ConfidenceIndicator({
  confidence,
  showLabel = true,
  className,
}: ConfidenceIndicatorProps) {
  const config = CONFIG[confidence];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      aria-label={config.label}
      title={config.label}
    >
      <span className="flex items-end gap-0.5">
        {[1, 2, 3].map((bar) => (
          <span
            key={bar}
            className={cn(
              "w-1 rounded-sm transition-colors",
              bar <= config.bars ? config.color : "bg-[#1E4560]"
            )}
            style={{ height: `${5 + bar * 2}px` }}
          />
        ))}
      </span>
      {showLabel && (
        <span className="font-mono text-[10px] text-[#86ADC2]">
          {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
        </span>
      )}
    </span>
  );
}

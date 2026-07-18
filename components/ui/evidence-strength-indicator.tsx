import { cn } from "@/lib/utils";
import type { EvidenceStrength } from "@/lib/types";

const CONFIG: Record<EvidenceStrength, { label: string; color: string; bg: string; border: string }> = {
  strong: {
    label: "Strong",
    color: "text-[#4FBF9A]",
    bg: "bg-[#12332B]",
    border: "border-[#4FBF9A]/30",
  },
  moderate: {
    label: "Moderate",
    color: "text-[#FFC94D]",
    bg: "bg-[#3A2A0E]",
    border: "border-[#FFC94D]/30",
  },
  weak: {
    label: "Weak",
    color: "text-[#F2796B]",
    bg: "bg-[#3A1414]",
    border: "border-[#F2796B]/30",
  },
  inconclusive: {
    label: "Inconclusive",
    color: "text-[#86ADC2]",
    bg: "bg-[#1E4560]/40",
    border: "border-[#86ADC2]/30",
  },
};

interface EvidenceStrengthIndicatorProps {
  strength: EvidenceStrength;
  className?: string;
}

export function EvidenceStrengthIndicator({
  strength,
  className,
}: EvidenceStrengthIndicatorProps) {
  const config = CONFIG[strength];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg border px-1.5 py-0.5 font-mono text-[10px] font-medium",
        config.color,
        config.bg,
        config.border,
        className
      )}
    >
      {config.label}
    </span>
  );
}

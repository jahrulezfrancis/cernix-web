"use client";

import { cn } from "@/lib/utils";
import type { Verdict } from "@/lib/types";
import {
  CheckCircle,
  CircleDashed,
  XCircle,
  AlertCircle,
  HelpCircle,
} from "lucide-react";

const VERDICT_CONFIG: Record<
  Verdict,
  { label: string; icon: React.ElementType; color: string; bg: string; border: string }
> = {
  verified: {
    label: "Verified",
    icon: CheckCircle,
    color: "text-[#4FBF9A]",
    bg: "bg-[#12332B]",
    border: "border-[#4FBF9A]/30",
  },
  partially_verified: {
    label: "Partially verified",
    icon: CircleDashed,
    color: "text-[#FFC94D]",
    bg: "bg-[#3A2A0E]",
    border: "border-[#FFC94D]/30",
  },
  unverified: {
    label: "Unverified",
    icon: XCircle,
    color: "text-[#F2796B]",
    bg: "bg-[#3A1414]",
    border: "border-[#F2796B]/30",
  },
  contradicted: {
    label: "Contradicted",
    icon: AlertCircle,
    color: "text-[#FF8540]",
    bg: "bg-[#3A230F]",
    border: "border-[#FF8540]/30",
  },
  inconclusive: {
    label: "Inconclusive",
    icon: HelpCircle,
    color: "text-[#86ADC2]",
    bg: "bg-[#1E4560]/40",
    border: "border-[#86ADC2]/30",
  },
};

interface VerdictBadgeProps {
  verdict: Verdict;
  size?: "sm" | "md";
  className?: string;
}

export function VerdictBadge({ verdict, size = "md", className }: VerdictBadgeProps) {
  const config = VERDICT_CONFIG[verdict];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border font-mono font-medium",
        config.color,
        config.bg,
        config.border,
        size === "sm"
          ? "px-1.5 py-0.5 text-[10px]"
          : "px-2 py-0.5 text-xs",
        className
      )}
      aria-label={`Verdict: ${config.label}`}
    >
      <Icon className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} aria-hidden />
      {config.label}
    </span>
  );
}

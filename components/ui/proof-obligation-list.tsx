import { cn } from "@/lib/utils";
import type { ProofObligation, ProofObligationStatus } from "@/lib/types";
import { CheckCircle, CircleDashed, XCircle, HelpCircle } from "lucide-react";

const STATUS_CONFIG: Record<
  ProofObligationStatus,
  { icon: React.ElementType; color: string; label: string }
> = {
  satisfied: {
    icon: CheckCircle,
    color: "text-[#4FBF9A]",
    label: "Satisfied",
  },
  partially_satisfied: {
    icon: CircleDashed,
    color: "text-[#FFC94D]",
    label: "Partially satisfied",
  },
  unsatisfied: {
    icon: XCircle,
    color: "text-[#F2796B]",
    label: "Unsatisfied",
  },
  unknown: {
    icon: HelpCircle,
    color: "text-[#86ADC2]",
    label: "Unknown",
  },
};

interface ProofObligationListProps {
  obligations: ProofObligation[];
  className?: string;
}

export function ProofObligationList({
  obligations,
  className,
}: ProofObligationListProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {obligations.map((ob) => {
        const config = STATUS_CONFIG[ob.status];
        const Icon = config.icon;
        return (
          <div
            key={ob.id}
            className="flex items-start gap-2.5 rounded-lg border border-[#1E4560] bg-[#123049] px-3 py-2"
          >
            <Icon
              className={cn("mt-0.5 h-4 w-4 shrink-0", config.color)}
              aria-label={config.label}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[#E9F3F8]">{ob.description}</p>
            </div>
            <span
              className={cn(
                "shrink-0 font-mono text-[10px]",
                config.color
              )}
            >
              {config.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

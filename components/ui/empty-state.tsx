import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[#1E4560] py-12 text-center",
        className
      )}
    >
      {Icon && (
        <div className="rounded-lg border border-[#1E4560] bg-[#123049] p-3">
          <Icon className="h-5 w-5 text-[#4F7590]" aria-hidden />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-[#E9F3F8]">{title}</p>
        {description && (
          <p className="max-w-xs text-xs text-[#86ADC2]">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

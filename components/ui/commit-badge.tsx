"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { GitCommitHorizontal, Copy, Check } from "lucide-react";

interface CommitBadgeProps {
  sha: string;
  className?: string;
}

export function CommitBadge({ sha, className }: CommitBadgeProps) {
  const [copied, setCopied] = useState(false);
  const short = sha.slice(0, 7);

  const handleCopy = () => {
    navigator.clipboard.writeText(sha);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "group inline-flex items-center gap-1 rounded-lg border border-[#1E4560] bg-[#082031] px-2 py-0.5 font-mono text-xs text-[#86ADC2] transition-colors hover:border-[#FF6B1A]/50 hover:text-[#E9F3F8]",
        className
      )}
      title={`Commit ${sha} — click to copy`}
      aria-label={`Commit ${short} — click to copy full SHA`}
    >
      <GitCommitHorizontal className="h-3 w-3 text-[#FF6B1A]" aria-hidden />
      {short}
      <span className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {copied ? (
          <Check className="h-2.5 w-2.5 text-[#4FBF9A]" aria-hidden />
        ) : (
          <Copy className="h-2.5 w-2.5" aria-hidden />
        )}
      </span>
    </button>
  );
}

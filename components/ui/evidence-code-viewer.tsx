"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Copy, Check, Code } from "lucide-react";

interface EvidenceCodeViewerProps {
  code: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  language?: string;
  className?: string;
}

export function EvidenceCodeViewer({
  code,
  path,
  lineStart = 1,
  lineEnd,
  language = "typescript",
  className,
}: EvidenceCodeViewerProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const lines = code.split("\n");
  const displayLines = !expanded && lines.length > 12 ? lines.slice(0, 12) : lines;
  const isTruncated = lines.length > 12 && !expanded;

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-[#1E4560] overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[#1E4560] bg-[#123049] px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Code className="h-3 w-3 shrink-0 text-[#FF6B1A]" aria-hidden />
          {path && (
            <span className="truncate font-mono text-[10px] text-[#86ADC2]">
              {path}
            </span>
          )}
          {lineStart && (
            <span className="shrink-0 font-mono text-[10px] text-[#4F7590]">
              L{lineStart}
              {lineEnd && lineEnd !== lineStart ? `–${lineEnd}` : ""}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#86ADC2] transition-colors hover:bg-[#1E4560] hover:text-[#E9F3F8]"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-3 w-3 text-[#4FBF9A]" aria-hidden />
          ) : (
            <Copy className="h-3 w-3" aria-hidden />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Code body */}
      <div className="overflow-x-auto bg-[#082031]">
        <table className="w-full border-collapse">
          <tbody>
            {displayLines.map((line, idx) => {
              const lineNum = lineStart + idx;
              return (
                <tr key={idx} className="group hover:bg-[#123049]/60">
                  <td
                    className="select-none border-r border-[#1E4560] px-3 py-0 text-right font-mono text-[10px] leading-5 text-[#4F7590]/60 group-hover:text-[#4F7590]"
                    aria-hidden
                  >
                    {lineNum}
                  </td>
                  <td className="px-4 py-0 font-mono text-xs leading-5 text-[#BFE0EC] whitespace-pre">
                    {line || " "}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {isTruncated && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full border-t border-[#1E4560] py-2 text-center font-mono text-[10px] text-[#86ADC2] transition-colors hover:bg-[#123049] hover:text-[#FF6B1A]"
          >
            Show {lines.length - 12} more lines
          </button>
        )}
      </div>
    </div>
  );
}

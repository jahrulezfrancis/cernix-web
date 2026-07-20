"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ApiRequestError, createInvestigation as createBackendInvestigation } from "@/lib/api/investigation-client";
import type { SubmissionType } from "@/lib/types";
import {
  CheckCircle,
  XCircle,
  Loader2,
  Info,
} from "lucide-react";

type ValidationState = "idle" | "success" | "error";

const SUBMISSION_TYPES = [
  { value: "hackathon_submission", label: "Hackathon submission" },
  { value: "grant_application", label: "Grant application" },
  { value: "milestone_report", label: "Milestone report" },
  { value: "technical_due_diligence", label: "Technical due diligence" },
  { value: "repository_documentation", label: "Repository documentation" },
  { value: "other", label: "Other" },
];

const EXAMPLE_DESCRIPTION = `This repository is a TypeScript web application with a PostgreSQL-backed API.

The README states that all mutations require authentication, that investigations are owner-scoped, and that durable workers process snapshot, planning, evidence, skeptic, and judge stages asynchronously.

The project uses Qwen via Alibaba DashScope for structured planning and judgment over admitted repository files only.`;

const GITHUB_REPO_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/i;

function isValidGitHubRepoUrl(url: string): boolean {
  return GITHUB_REPO_URL.test(url.trim());
}

export default function NewInvestigationPage() {
  const router = useRouter();

  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [submissionType, setSubmissionType] = useState<SubmissionType>("hackathon_submission");
  const [description, setDescription] = useState(EXAMPLE_DESCRIPTION);
  const [focusQuestion, setFocusQuestion] = useState(
    "Verify whether investigation API routes enforce owner-scoped access for every read and mutation."
  );

  const [validationState, setValidationState] = useState<ValidationState>("idle");
  const [validationError, setValidationError] = useState("");

  const [creating, setCreating] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    const trimmed = repoUrl.trim();
    if (!trimmed) {
      setValidationState("idle");
      setValidationError("");
      return;
    }
    if (isValidGitHubRepoUrl(trimmed)) {
      setValidationState("success");
      setValidationError("");
      return;
    }
    setValidationState("error");
    setValidationError("Enter a valid public GitHub repository URL.");
  }, [repoUrl]);

  const handleCreate = async () => {
    if (validationState !== "success") return;
    const claimStatement = (focusQuestion.trim() || description.trim()).slice(0, 4000);
    if (!claimStatement.trim()) return;
    setCreating(true);
    setSubmitError("");
    try {
      const created = await createBackendInvestigation({
        repositoryUrl: repoUrl.trim(),
        repositoryRef: branch.trim() || undefined,
        claim: { statement: claimStatement },
      }, crypto.randomUUID());
      router.push(`/investigations/${created.id}/claims`);
    } catch (error) {
      setSubmitError(error instanceof ApiRequestError ? error.message : "Unable to create investigation.");
      setCreating(false);
    }
  };
  const canSubmit =
    validationState === "success" &&
    description.trim().length > 20 &&
    (focusQuestion.trim().length > 0 || description.trim().length > 40) &&
    !creating;

  return (
    <AppShell title="New investigation">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-[#E9F3F8]">
            New investigation
          </h1>
          <p className="mt-1 text-sm text-[#86ADC2]">
            Provide a public repository, submission context, and one claim to
            verify. You will review the claim before workers start.
          </p>
        </div>

        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) handleCreate();
          }}
        >
          {/* Repository URL */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="repo-url"
              className="font-mono text-xs text-[#86ADC2]"
            >
              Repository URL
            </label>
            <div className="relative">
              <input
                id="repo-url"
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repository"
                className="w-full rounded-lg border border-[#1E4560] bg-[#082031] px-3 py-2 pr-9 font-mono text-sm text-[#E9F3F8] placeholder-[#4F7590] outline-none transition-colors focus:border-[#FF6B1A]"
                required
                aria-describedby="repo-url-status"
              />
              <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                {validationState === "success" && (
                  <CheckCircle className="h-4 w-4 text-[#4FBF9A]" aria-hidden />
                )}
                {validationState === "error" && (
                  <XCircle className="h-4 w-4 text-[#F2796B]" aria-hidden />
                )}
              </div>
            </div>
            {validationState === "error" && (
              <p id="repo-url-status" className="font-mono text-xs text-[#F2796B]" role="alert">
                {validationError}
              </p>
            )}
          </div>

          {validationState === "success" && (
            <div className="rounded-lg border border-[#1E4560] bg-[#123049]">
              <div className="flex items-start gap-2 px-4 py-3">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#86ADC2]" aria-hidden />
                <div>
                  <p className="font-mono text-xs text-[#E9F3F8]">
                    Repository URL accepted
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[#86ADC2]">
                    Branch, commit, and repository metadata will be resolved when the
                    investigation snapshot runs after claim approval.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Branch */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="branch" className="font-mono text-xs text-[#86ADC2]">
              Branch
            </label>
            <input
              id="branch"
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
              className="w-full rounded-lg border border-[#1E4560] bg-[#082031] px-3 py-2 font-mono text-sm text-[#E9F3F8] placeholder-[#4F7590] outline-none transition-colors focus:border-[#FF6B1A]"
            />
          </div>

          {/* Submission type */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="submission-type"
              className="font-mono text-xs text-[#86ADC2]"
            >
              Submission type
            </label>
            <select
              id="submission-type"
              value={submissionType}
              onChange={(e) => setSubmissionType(e.target.value as SubmissionType)}
              className="w-full rounded-lg border border-[#1E4560] bg-[#082031] px-3 py-2 text-sm text-[#E9F3F8] outline-none transition-colors focus:border-[#FF6B1A]"
            >
              {SUBMISSION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="description"
              className="font-mono text-xs text-[#86ADC2]"
            >
              Project description or submission
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={10}
              placeholder="Paste the submission document, grant application, or project description here..."
              className="w-full resize-y rounded-lg border border-[#1E4560] bg-[#082031] px-3 py-2 text-sm leading-relaxed text-[#E9F3F8] placeholder-[#4F7590] outline-none transition-colors focus:border-[#FF6B1A]"
              required
            />
            <p className="font-mono text-[10px] text-[#4F7590]">
              {description.trim().split(/\s+/).filter(Boolean).length} words
            </p>
          </div>

          {/* Focus question */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="focus"
              className="font-mono text-xs text-[#86ADC2]"
            >
              Focus claim{" "}
              <span className="text-[#4F7590]">(primary — used as the investigation claim)</span>
            </label>
            <input
              id="focus"
              type="text"
              value={focusQuestion}
              onChange={(e) => setFocusQuestion(e.target.value)}
              placeholder="E.g. Verify whether API routes enforce owner-scoped access."
              className="w-full rounded-lg border border-[#1E4560] bg-[#082031] px-3 py-2 text-sm text-[#E9F3F8] placeholder-[#4F7590] outline-none transition-colors focus:border-[#FF6B1A]"
            />
          </div>

          {submitError && (
            <p className="rounded border border-[#FFC94D]/30 bg-[#3A2A0E] px-3 py-2 font-mono text-xs text-[#FFC94D]" role="status">
              {submitError}
            </p>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex items-center gap-2 rounded-lg bg-[#FF6B1A] px-5 py-2.5 text-sm font-medium text-[#0B1E2E] transition-colors hover:bg-[#FF8540] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Creating investigation...
                </>
              ) : (
                "Continue to claim review"
              )}
            </button>
            {validationState === "idle" ? (
              <p className="text-xs text-[#4F7590]">
                Enter a valid GitHub repository URL to continue.
              </p>
            ) : validationState === "error" ? (
              <p className="font-mono text-xs text-[#F2796B]">
                Repository URL format is invalid.
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </AppShell>
  );
}

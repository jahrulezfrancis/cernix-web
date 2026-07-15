"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { createInvestigation, getStorageHealth } from "@/lib/investigation-repository";
import type { SubmissionType } from "@/lib/types";
import {
  CheckCircle,
  XCircle,
  Loader2,
  GitBranch,
  GitCommitHorizontal,
  FileCode,
  FlaskConical,
  Workflow,
  HardDrive,
  Files,
  Globe,
} from "lucide-react";

type ValidationState = "idle" | "loading" | "success" | "error";

const SUBMISSION_TYPES = [
  { value: "hackathon_submission", label: "Hackathon submission" },
  { value: "grant_application", label: "Grant application" },
  { value: "milestone_report", label: "Milestone report" },
  { value: "technical_due_diligence", label: "Technical due diligence" },
  { value: "repository_documentation", label: "Repository documentation" },
  { value: "other", label: "Other" },
];

const EXAMPLE_DESCRIPTION = `This project is a multi-agent verification platform built for the Alibaba Cloud Hackathon.

The platform automatically verifies every pull request using a combination of static analysis and dynamic testing. We use Alibaba Cloud ECS for production deployment, with Alibaba Cloud OSS for artifact storage.

The multi-agent workflow coordinates five specialized agents: a Claim Analyst, Repository Investigator, Delivery Investigator, Skeptic Agent, and Evidence Judge.

All data is end-to-end encrypted using industry-standard AES-256. Test coverage exceeds 80% across all modules, verified by our CI pipeline. No critical security vulnerabilities exist in our production dependencies as confirmed by our latest audit.

Milestones 1 through 3 have been completed on time, with all deliverables committed before the respective deadlines.`;

const MOCK_REPO_DATA = {
  found: true,
  isPublic: true,
  branch: "main",
  commitSha: "3e7f2c1a9b4d8e5f0a3b6c9d2e5f8a1b4c7d0e3f",
  language: "TypeScript",
  sizeKb: 6240,
  fileCount: 448,
  hasTests: true,
  hasWorkflows: true,
};

export default function NewInvestigationPage() {
  const router = useRouter();

  const [repoUrl, setRepoUrl] = useState("https://github.com/acme/stellar-service");
  const [branch, setBranch] = useState("");
  const [submissionType, setSubmissionType] = useState<SubmissionType>("hackathon_submission");
  const [description, setDescription] = useState(EXAMPLE_DESCRIPTION);
  const [focusQuestion, setFocusQuestion] = useState(
    "Verify whether the project genuinely implements a multi-agent workflow and uses Alibaba Cloud in production."
  );

  const [validationState, setValidationState] = useState<ValidationState>("idle");
  const [validationError, setValidationError] = useState("");
  const [repoData, setRepoData] = useState<typeof MOCK_REPO_DATA | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");

  useEffect(() => {
    if (!repoUrl) {
      setValidationState("idle");
      setRepoData(null);
      return;
    }
    const isGitHub = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(repoUrl);
    if (!isGitHub) return;

    setValidationState("loading");
    setRepoData(null);
    setBranch("");

    const timer = setTimeout(() => {
      if (repoUrl.includes("private") || repoUrl.includes("404")) {
        setValidationState("error");
        setValidationError("Repository not found or access denied.");
      } else {
        setValidationState("success");
        setRepoData(MOCK_REPO_DATA);
        setBranch(MOCK_REPO_DATA.branch);
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [repoUrl]);

  const handleExtractClaims = async () => {
    if (!repoData) return;
    setExtracting(true);
    await new Promise((r) => setTimeout(r, 700));

    const investigation = createInvestigation({
      repositoryUrl: repoUrl,
      branch,
      submissionType,
      description,
      focusQuestion,
      repositoryMetadata: repoData,
    });
    const health = getStorageHealth();
    setStorageWarning(health.status === "available" ? "" : health.message);
    router.push(`/investigations/${investigation.id}/claims`);
  };

  const canSubmit =
    validationState === "success" &&
    description.trim().length > 20 &&
    !extracting;

  return (
    <AppShell title="New investigation">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-[#E9F3F8]">
            New investigation
          </h1>
          <p className="mt-1 text-sm text-[#86ADC2]">
            Provide a public repository and a submission document. Cernix will
            extract technical claims and prepare them for investigation.
          </p>
        </div>

        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) handleExtractClaims();
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
                {validationState === "loading" && (
                  <Loader2 className="h-4 w-4 animate-spin text-[#FF6B1A]" aria-hidden />
                )}
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

          {/* Repository validation panel */}
          {validationState === "success" && repoData && (
            <div className="rounded-lg border border-[#4FBF9A]/20 bg-[#123049]">
              <div className="flex items-center gap-2 border-b border-[#1E4560] px-4 py-2.5">
                <CheckCircle className="h-3.5 w-3.5 text-[#4FBF9A]" aria-hidden />
                <span className="font-mono text-xs text-[#4FBF9A]">
                  Repository validated
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 sm:grid-cols-4">
                {[
                  {
                    icon: Globe,
                    label: "Visibility",
                    value: "Public",
                    color: "text-[#4FBF9A]",
                  },
                  {
                    icon: GitBranch,
                    label: "Branch",
                    value: repoData.branch,
                    color: "text-[#E9F3F8]",
                  },
                  {
                    icon: GitCommitHorizontal,
                    label: "Latest commit",
                    value: repoData.commitSha.slice(0, 7),
                    color: "text-[#FF6B1A]",
                    mono: true,
                  },
                  {
                    icon: FileCode,
                    label: "Language",
                    value: repoData.language,
                    color: "text-[#E9F3F8]",
                  },
                  {
                    icon: HardDrive,
                    label: "Size",
                    value: `${(repoData.sizeKb / 1024).toFixed(1)} MB`,
                    color: "text-[#E9F3F8]",
                  },
                  {
                    icon: Files,
                    label: "Files",
                    value: repoData.fileCount.toLocaleString(),
                    color: "text-[#E9F3F8]",
                  },
                  {
                    icon: FlaskConical,
                    label: "Tests",
                    value: repoData.hasTests ? "Detected" : "None found",
                    color: repoData.hasTests ? "text-[#4FBF9A]" : "text-[#F2796B]",
                  },
                  {
                    icon: Workflow,
                    label: "Workflows",
                    value: repoData.hasWorkflows ? "Detected" : "None found",
                    color: repoData.hasWorkflows ? "text-[#4FBF9A]" : "text-[#F2796B]",
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1 font-mono text-[10px] text-[#4F7590]">
                        <Icon className="h-3 w-3" aria-hidden />
                        {item.label}
                      </span>
                      <span className={`font-mono text-xs ${item.color}`}>
                        {item.value}
                      </span>
                    </div>
                  );
                })}
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
              Focus question{" "}
              <span className="text-[#4F7590]">(optional)</span>
            </label>
            <input
              id="focus"
              type="text"
              value={focusQuestion}
              onChange={(e) => setFocusQuestion(e.target.value)}
              placeholder="E.g. Verify whether the multi-agent workflow is genuinely implemented."
              className="w-full rounded-lg border border-[#1E4560] bg-[#082031] px-3 py-2 text-sm text-[#E9F3F8] placeholder-[#4F7590] outline-none transition-colors focus:border-[#FF6B1A]"
            />
          </div>

          {storageWarning && (
            <p className="rounded border border-[#FFC94D]/30 bg-[#3A2A0E] px-3 py-2 font-mono text-xs text-[#FFC94D]" role="status">
              {storageWarning}
            </p>
          )}

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex items-center gap-2 rounded-lg bg-[#FF6B1A] px-5 py-2.5 text-sm font-medium text-[#0B1E2E] transition-colors hover:bg-[#FF8540] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {extracting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Extracting claims...
                </>
              ) : (
                "Extract claims"
              )}
            </button>
            {!validationState || validationState === "idle" ? (
              <p className="text-xs text-[#4F7590]">
                Enter a valid GitHub repository URL to continue.
              </p>
            ) : validationState === "loading" ? (
              <p className="font-mono text-xs text-[#FF6B1A]">
                Validating repository...
              </p>
            ) : validationState === "error" ? (
              <p className="font-mono text-xs text-[#F2796B]">
                Repository validation failed.
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </AppShell>
  );
}

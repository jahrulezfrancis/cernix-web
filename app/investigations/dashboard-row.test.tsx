import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvestigationRow } from "./page";
import type { Investigation } from "@/lib/types";

const fixture: Investigation = {
  id: "00000000-0000-4000-8000-000000000001",
  project: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "acme/widget",
    repositoryUrl: "https://github.com/acme/widget",
    owner: "acme",
    repo: "widget",
    description: "Example claim",
  },
  repositorySnapshot: {
    owner: "acme",
    repo: "widget",
    branch: "main",
    commitSha: "0000000000000000000000000000000000000000",
    primaryLanguage: "TypeScript",
    languages: ["TypeScript"],
    sizeKb: 100,
    fileCount: 10,
    hasTests: true,
    hasWorkflows: false,
    snapshotAt: "2026-01-01T00:00:00.000Z",
  },
  submission: {
    id: "sub-1",
    projectId: "00000000-0000-4000-8000-000000000001",
    type: "technical_due_diligence",
    content: "The service validates input at the API boundary.",
    submittedAt: "2026-01-01T00:00:00.000Z",
  },
  status: "failed",
  claims: [],
  agentRuns: [],
  workflowStages: [],
  requiresHumanReview: false,
};

describe("InvestigationRow", () => {
  it("renders failed investigations without a navigation target", () => {
    const markup = renderToStaticMarkup(<InvestigationRow inv={fixture} />);
    expect(markup).toContain("No automatic retry");
    expect(markup).not.toContain("href=");
  });
});

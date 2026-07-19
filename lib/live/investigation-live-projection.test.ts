import { describe, expect, it } from "vitest";
import {
  describeInvestigationEvent,
  projectInvestigationLiveView,
} from "./investigation-live-projection";
import type { InvestigationEventResponse, InvestigationResponse } from "@/lib/contracts/investigation-api";

function investigation(overrides: Partial<InvestigationResponse> = {}): InvestigationResponse {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status: "investigating",
    repository: {
      owner: "acme",
      name: "demo",
      canonicalUrl: "https://github.com/acme/demo",
      requestedRef: "main",
    },
    version: 1,
    createdAt: "2026-07-19T12:00:00.000Z",
    updatedAt: "2026-07-19T12:05:00.000Z",
    startedAt: "2026-07-19T12:01:00.000Z",
    completedAt: null,
    failureCode: null,
    claim: {
      id: "00000000-0000-4000-8000-000000000002",
      statement: "The repository includes automated tests.",
      preservedQualifiers: [],
      approvedAt: "2026-07-19T12:00:30.000Z",
    },
    ...overrides,
  };
}

function event(
  sequence: number,
  type: string,
  stage: InvestigationEventResponse["stage"],
  publicPayload: unknown
): InvestigationEventResponse {
  return {
    sequence,
    type,
    stage,
    publicPayload,
    createdAt: `2026-07-19T12:0${sequence}:00.000Z`,
  };
}

describe("describeInvestigationEvent", () => {
  it("summarizes snapshot persistence with readable detail", () => {
    const summary = describeInvestigationEvent(
      event(1, "repository_snapshot_persisted", "snapshotting", {
        commitSha: "abcdef1234567890abcdef1234567890abcdef12",
        admittedFileCount: 42,
        inspectedEntryCount: 120,
      })
    );

    expect(summary.title).toBe("Repository snapshot persisted");
    expect(summary.detail).toContain("abcdef1");
    expect(summary.detail).toContain("42 admitted files");
    expect(summary.tone).toBe("success");
  });
});

describe("projectInvestigationLiveView", () => {
  it("marks the active workflow stage and agent while investigating", () => {
    const events = [
      event(1, "repository_snapshot_persisted", "snapshotting", {
        commitSha: "abcdef1234567890abcdef1234567890abcdef12",
        admittedFileCount: 10,
        inspectedEntryCount: 20,
      }),
      event(2, "investigation_plan_persisted", "planning", {
        taskCount: 3,
        obligationCount: 2,
      }),
      event(3, "evidence_task_completed", "investigating", {
        taskKey: "task-1",
        candidateCount: 2,
        gapCount: 1,
        counterCount: 0,
      }),
    ];

    const projection = projectInvestigationLiveView(investigation(), events);

    expect(projection.workflowStages.find((stage) => stage.id === "investigating")?.status).toBe("active");
    expect(projection.workflowStages.find((stage) => stage.id === "snapshotting")?.status).toBe("completed");
    expect(projection.agents.find((agent) => agent.id === "investigator")?.status).toBe("running");
    expect(projection.agents.find((agent) => agent.id === "planner")?.status).toBe("completed");
    expect(projection.progressLabel).toBe("Evidence gathering");
  });

  it("includes reinvestigation when the lifecycle visited that stage", () => {
    const events = [
      event(1, "reinvestigation_started", "reinvestigating", {
        cycle: 1,
        taskKeys: ["task-2"],
      }),
    ];

    const projection = projectInvestigationLiveView(
      investigation({ status: "reinvestigating" }),
      events
    );

    expect(projection.workflowStages.some((stage) => stage.id === "reinvestigating")).toBe(true);
    expect(projection.agents.find((agent) => agent.id === "investigator")?.status).toBe("running");
  });

  it("marks failed stages when the investigation fails", () => {
    const events = [
      event(1, "lifecycle_transitioned", "failed", {
        from: "planning",
        to: "failed",
      }),
    ];

    const projection = projectInvestigationLiveView(
      investigation({ status: "failed", failureCode: "plan_schema_invalid" }),
      events
    );

    expect(projection.workflowStages.find((stage) => stage.id === "planning")?.status).toBe("failed");
    expect(projection.agents.find((agent) => agent.id === "planner")?.status).toBe("failed");
    expect(projection.claimStatusLabel).toBe("Failed");
  });
});

import { describe, expect, it } from "vitest";
import { runPlanningWorkerCli } from "./run-planning-worker";

describe("planning worker CLI", () => {
  it("imports without reading worker/database configuration and rejects unknown arguments safely", async () => {
    await expect(runPlanningWorkerCli(["--unknown"])).resolves.toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { runSnapshotWorkerCli } from "./run-snapshot-worker";

describe("snapshot worker CLI", () => {
  it("imports without reading worker/database configuration and rejects unknown arguments safely", async () => {
    await expect(runSnapshotWorkerCli(["--unknown"])).resolves.toBe(2);
  });
});

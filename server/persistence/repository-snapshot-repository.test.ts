import { describe, expect, it } from "vitest";
import { isSnapshotWinnerConflict } from "./repository-snapshot-repository";

describe("snapshot uniqueness race classification", () => {
  it("accepts only the named one-snapshot-per-investigation constraint", () => {
    expect(isSnapshotWinnerConflict({ code: "23505", constraint: "repository_snapshots_investigation_unique" })).toBe(true);
    for (const error of [
      { code: "23505" },
      { code: "23505", constraint: "repository_snapshot_entries_path_unique" },
      { code: "23505", constraint: "repository_snapshot_entries_order_unique" },
      { code: "23505", constraint: "repository_snapshot_files_entry_id_key" },
      { code: "23503", constraint: "repository_snapshots_investigation_unique" },
    ]) expect(isSnapshotWinnerConflict(error)).toBe(false);
  });
});

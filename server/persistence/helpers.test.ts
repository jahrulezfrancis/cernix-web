import { describe, expect, it } from "vitest";
import { ApplicationError, toPublicSafeError } from "@/server/errors";
import { boundEventLimit, hashCreateInput, hashStartInput, parseEventCursor, safeFailureCode } from "./helpers";

describe("persistence helpers", () => {
  it("hashes explicitly ordered operation values deterministically", () => {
    const input = { owner: "A", repo: "B", canonicalUrl: "https://github.com/A/B",
      requestedRef: "main", statement: "claim", qualifiers: ["one", "two"] };
    expect(hashCreateInput(input)).toBe(hashCreateInput({ ...input }));
    expect(hashCreateInput(input)).not.toBe(hashCreateInput({ ...input, qualifiers: ["two", "one"] }));
    expect(hashStartInput("8c8bc9ee-7c3e-4e2d-8f3e-a2ed0b7e1157")).toHaveLength(64);
  });
  it("parses precision-safe cursors and bounded limits", () => {
    expect(parseEventCursor("9007199254740993")).toBe("9007199254740993");
    expect(parseEventCursor("9223372036854775807")).toBe("9223372036854775807");
    expect(boundEventLimit(1)).toBe(1);
    expect(boundEventLimit(100)).toBe(100);
    expect(() => parseEventCursor("-1")).toThrow(ApplicationError);
    expect(() => parseEventCursor("9223372036854775808")).toThrow(ApplicationError);
    expect(() => boundEventLimit(101)).toThrow(ApplicationError);
  });
  it("accepts only safe failure classifications", () => {
    expect(safeFailureCode("snapshot_timeout")).toBe("snapshot_timeout");
    expect(() => safeFailureCode("password=secret")).toThrow(ApplicationError);
  });
  it("keeps database failure details out of public serialization", () => {
    const error = new ApplicationError("dependency_unavailable", {
      cause: new Error("postgresql://user:secret@host/db select * from private"),
    });
    expect(JSON.stringify(toPublicSafeError(error))).not.toContain("secret");
    expect(JSON.stringify(error)).not.toContain("select");
  });
});

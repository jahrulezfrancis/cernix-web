import { describe, expect, it } from "vitest";
import { containsHighConfidenceSecret } from "./secret-scan";

describe("high-confidence secret scanner", () => {
  it.each([
    [`-----BEGIN ${"PRIVATE"} KEY-----`, true],
    [`gh${"p"}_${"A".repeat(36)}`, true],
    [`AK${"IA"}${"A1".repeat(8)}`, true],
    [`authorization: Bearer ${"aB3_".repeat(7)}`, true],
    [`API_KEY = '${"z9_".repeat(9)}'`, true],
    [`-----BEGIN PUBLIC KEY-----`, false],
    [`gh${"p"}_${"A".repeat(35)}`, false],
    [`AK${"IA"}${"A1".repeat(7)}`, false],
    ["authorization: Bearer short", false],
    ["api_key = ordinary-setting", false],
  ])("classifies synthetic signatures without returning the matched value", (value, expected) => {
    expect(containsHighConfidenceSecret(value)).toBe(expected);
  });

  it("handles CRLF and mixed-case credential labels at the maximum file bound", () => {
    const credential = `${"Q7_".repeat(9)}`;
    const text = `${"x".repeat(1_000_000)}\r\nAcCeSs_ToKeN: ${credential}\r\n`;
    expect(containsHighConfidenceSecret(text)).toBe(true);
  });
});

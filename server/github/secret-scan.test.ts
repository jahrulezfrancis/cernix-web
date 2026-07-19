import { describe, expect, it } from "vitest";
import { containsHighConfidenceSecretV1, secretPolicyEvaluator } from "./secret-scan";

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
    expect(containsHighConfidenceSecretV1(value)).toBe(expected);
  });

  it("handles CRLF and mixed-case credential labels at the maximum file bound", () => {
    const credential = `${"Q7_".repeat(9)}`;
    const text = `${"x".repeat(1_000_000)}\r\nAcCeSs_ToKeN: ${credential}\r\n`;
    expect(containsHighConfidenceSecretV1(text)).toBe(true);
  });

  it.each(["p", "o", "u", "s", "r"])("detects the synthetic gh%s token family in policy version 1", (family) => {
    expect(secretPolicyEvaluator(1)(`gh${family}_${"A7".repeat(18)}`)).toBe(true);
  });

  it.each([
    `github_pat_${"A7_".repeat(8)}`,
    `AS${"IA"}${"A1".repeat(8)}`,
    `sk-live-${"aB3_".repeat(5)}`,
    `sk-proj-${"aB3_".repeat(5)}`,
    `xoxb-${"aB3-".repeat(5)}Z`,
    `xoxa-${"aB3-".repeat(5)}Z`,
    `xoxp-${"aB3-".repeat(5)}Z`,
    `xoxr-${"aB3-".repeat(5)}Z`,
    `xoxs-${"aB3-".repeat(5)}Z`,
    `AIza${"A7_".repeat(11)}A7`,
  ])("detects every other supported synthetic token family in policy version 1", (value) => {
    expect(secretPolicyEvaluator(1)(value)).toBe(true);
  });

  it("keeps version-1 behavior separate from a simulated future rule", () => {
    const futureOnly = "future-policy-marker";
    const simulatedFutureEvaluator = (text: string) => text.includes(futureOnly);
    expect(simulatedFutureEvaluator(futureOnly)).toBe(true);
    expect(secretPolicyEvaluator(1)(futureOnly)).toBe(false);
    expect(secretPolicyEvaluator(1)).toBe(containsHighConfidenceSecretV1);
  });

  it("rejects unsupported admission-policy versions", () => {
    expect(() => secretPolicyEvaluator(0)).toThrow(RangeError);
    expect(() => secretPolicyEvaluator(2)).toThrow(RangeError);
  });
});

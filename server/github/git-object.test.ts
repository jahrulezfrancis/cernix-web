import { describe, expect, it } from "vitest";
import { gitBlobSha1 } from "./git-object";

describe("Git blob object identity", () => {
  it.each([
    ["empty bytes", new Uint8Array(), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],
    ["ASCII without LF", Buffer.from("hello"), "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0"],
    ["ASCII with LF", Buffer.from("hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a"],
    ["CRLF before normalization", Buffer.from("hello\r\n"), "ef0493b275aa2080237f676d2ef6559246f56636"],
    ["multibyte UTF-8", Buffer.from("é🙂"), "1c6696f409aac7394328a39b290a181d17125f78"],
    ["embedded NUL and binary", new Uint8Array([0, 1, 255, 65]), "a2830ddf080e8b4791d36a46dd721128a15e6932"],
    ["one-digit byte length", Buffer.from("123456789"), "e2e107ac61ac259b87c544f6e7a4eb03422c6c21"],
    ["two-digit byte length", Buffer.from("1234567890"), "6a537b5b367880eac21e3c0f0a382de7a19bd30a"],
  ])("matches an independently verified Git vector for %s", (_name, raw, expected) => {
    expect(gitBlobSha1(raw)).toBe(expected);
  });
});

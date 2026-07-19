import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("load local env", () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.chdir(originalCwd);
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("loads unset variables from .env.local without overriding existing values", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cernix-env-"));
    writeFileSync(join(directory, ".env.local"), [
      "QWEN_API_ORIGIN=https://dashscope-intl.aliyuncs.com",
      "QWEN_API_KEY=from-file",
    ].join("\n"), "utf8");
    process.chdir(directory);
    process.env.QWEN_API_KEY = "from-shell";
    delete process.env.QWEN_API_ORIGIN;
    await import("@/server/load-local-env");
    expect(process.env.QWEN_API_KEY).toBe("from-shell");
    expect(process.env.QWEN_API_ORIGIN).toBe("https://dashscope-intl.aliyuncs.com");
    if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
  });
});

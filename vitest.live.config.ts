import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: { include: ["server/github/**/*.live-smoke.test.ts"], fileParallelism: false, testTimeout: 120_000 },
});

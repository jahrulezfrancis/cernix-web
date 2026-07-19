import { parseQwenPlanningConfig, type QwenPlanningConfig } from "./config";

let cached: QwenPlanningConfig | undefined;

export function readQwenPlanningConfig(environment: NodeJS.ProcessEnv = process.env): QwenPlanningConfig {
  if (!cached) cached = parseQwenPlanningConfig(environment);
  return cached;
}

export function resetQwenPlanningConfigForTests(): void {
  cached = undefined;
}

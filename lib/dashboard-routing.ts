import type { Investigation } from "./types";
import { continuationRoute } from "./investigation-lifecycle";

export function dashboardRoute(investigation: Investigation, demo = false): string | null {
  if (demo || investigation.status === "failed") return null;
  return continuationRoute(investigation.id, investigation.status, !!investigation.report);
}

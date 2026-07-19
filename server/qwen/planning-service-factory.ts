import { parseQwenPlanningConfig } from "./config";
import { getDatabase } from "@/server/db/database";
import { InvestigationPlanRepository } from "@/server/persistence/investigation-plan-repository";
import { QwenClient } from "./client";
import { InvestigationPlanningService } from "./planning-service";

export function createInvestigationPlanningService(): InvestigationPlanningService {
  const config = parseQwenPlanningConfig(process.env);
  return new InvestigationPlanningService(new InvestigationPlanRepository(getDatabase()), new QwenClient(config), config);
}

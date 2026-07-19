import { parseQwenPlanningConfig } from "./config";
import { getDatabase } from "@/server/db/database";
import { SkepticRepository } from "@/server/persistence/skeptic-repository";
import { QwenClient } from "./client";
import { InvestigationSkepticService } from "./skeptic-service";

export function createInvestigationSkepticService(): InvestigationSkepticService {
  const config = parseQwenPlanningConfig(process.env);
  return new InvestigationSkepticService(new SkepticRepository(getDatabase()), new QwenClient(config), config);
}

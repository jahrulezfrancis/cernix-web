import { parseQwenPlanningConfig } from "./config";
import { getDatabase } from "@/server/db/database";
import { JudgmentRepository } from "@/server/persistence/judgment-repository";
import { QwenClient } from "./client";
import { InvestigationJudgeService } from "./judge-service";

export function createInvestigationJudgeService(): InvestigationJudgeService {
  const config = parseQwenPlanningConfig(process.env);
  return new InvestigationJudgeService(new JudgmentRepository(getDatabase()), new QwenClient(config), config);
}

import { parseQwenPlanningConfig } from "./config";
import { getDatabase } from "@/server/db/database";
import { EvidenceRepository } from "@/server/persistence/evidence-repository";
import { QwenClient } from "./client";
import { RepositoryInvestigatorService } from "./investigator-service";

export function createRepositoryInvestigatorService(): RepositoryInvestigatorService {
  const config = parseQwenPlanningConfig(process.env);
  return new RepositoryInvestigatorService(new EvidenceRepository(getDatabase()), new QwenClient(config), config);
}

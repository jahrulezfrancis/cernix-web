import { getDatabase } from "@/server/db/database";
import { InvestigationRepository } from "@/server/persistence/investigation-repository";
import { JudgmentRepository } from "@/server/persistence/judgment-repository";

export function investigationRepository() {
  return new InvestigationRepository(getDatabase());
}

export function judgmentRepository() {
  return new JudgmentRepository(getDatabase());
}

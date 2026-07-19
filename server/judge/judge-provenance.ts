import type { JudgeArtifact } from "@/lib/contracts/judgment-report";
import { ApplicationError } from "@/server/errors";

export function validateJudgeClaimCoverage(artifact: JudgeArtifact, claimIds: readonly string[]): void {
  const expected = new Set(claimIds);
  const provided = new Set(artifact.claimJudgments.map((judgment) => judgment.claimId));
  if (expected.size !== provided.size || [...expected].some((claimId) => !provided.has(claimId))) {
    throw new ApplicationError("malformed_input", {});
  }
}

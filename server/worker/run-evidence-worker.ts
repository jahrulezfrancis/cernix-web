import "@/server/load-local-env";
import { pathToFileURL } from "node:url";
import { closeDatabase, getDatabase } from "@/server/db/database";
import { EvidenceRepository } from "@/server/persistence/evidence-repository";
import { createRepositoryInvestigatorService } from "@/server/qwen/investigator-service-factory";
import { EvidenceJobRepository } from "./evidence-job-repository";
import { EvidenceWorker, type EvidenceWorkerLogger } from "./evidence-worker";
import { readEvidenceWorkerConfig } from "./evidence-worker-config";

const logger: EvidenceWorkerLogger = { info(event, fields) { console.log(JSON.stringify({ event, ...fields })); } };

export async function runEvidenceWorkerCli(arguments_: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (arguments_.some((argument) => argument !== "--once")) return 2;
  const once = arguments_.includes("--once"), controller = new AbortController();
  const stop = () => controller.abort(new Error("Worker shutdown requested."));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const workerConfig = readEvidenceWorkerConfig(), db = getDatabase();
    const evidence = new EvidenceRepository(db);
    const investigator = createRepositoryInvestigatorService();
    const worker = new EvidenceWorker(new EvidenceJobRepository(db), investigator, evidence, {
      owner: workerConfig.owner, leaseSeconds: workerConfig.leaseSeconds,
      heartbeatSeconds: workerConfig.heartbeatSeconds, pollMs: workerConfig.pollMs,
      baseSeconds: workerConfig.retryBaseSeconds, maximumSeconds: workerConfig.retryMaxSeconds,
    }, logger);
    if (once) {
      const result = await worker.runOnce(controller.signal);
      return result.status === "failed" || result.status === "lease_lost" ? 1 : 0;
    }
    await worker.runLoop(controller.signal);
    return 0;
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    await closeDatabase();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runEvidenceWorkerCli().then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}

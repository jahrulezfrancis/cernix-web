import "@/server/load-local-env";
import { pathToFileURL } from "node:url";
import { closeDatabase, getDatabase } from "@/server/db/database";
import { createInvestigationJudgeService } from "@/server/qwen/judge-service-factory";
import { JudgeJobRepository } from "./judge-job-repository";
import { JudgeWorker, type JudgeWorkerLogger } from "./judge-worker";
import { readJudgeWorkerConfig } from "./judge-worker-config";

const logger: JudgeWorkerLogger = { info(event, fields) { console.log(JSON.stringify({ event, ...fields })); } };

export async function runJudgeWorkerCli(arguments_: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (arguments_.some((argument) => argument !== "--once")) return 2;
  const once = arguments_.includes("--once"), controller = new AbortController();
  const stop = () => controller.abort(new Error("Worker shutdown requested."));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const workerConfig = readJudgeWorkerConfig(), db = getDatabase();
    const judge = createInvestigationJudgeService();
    const worker = new JudgeWorker(new JudgeJobRepository(db), judge, {
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
  runJudgeWorkerCli().then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}

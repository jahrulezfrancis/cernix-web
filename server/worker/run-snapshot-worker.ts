import "@/server/load-local-env";
import { pathToFileURL } from "node:url";
import { closeDatabase, getDatabase } from "@/server/db/database";
import { RepositorySnapshotRepository } from "@/server/persistence/repository-snapshot-repository";
import { GitHubClient } from "@/server/github/client";
import { parseGitHubSnapshotConfig } from "@/server/github/config";
import { RepositorySnapshotService } from "@/server/github/snapshot-service";
import { buildRepositorySnapshot } from "@/server/github/snapshotter";
import { SnapshotJobRepository } from "./snapshot-job-repository";
import { SnapshotWorker, type WorkerLogger } from "./snapshot-worker";
import { readSnapshotWorkerConfig } from "./worker-config";

const logger: WorkerLogger = { info(event, fields) { console.log(JSON.stringify({ event, ...fields })); } };

export async function runSnapshotWorkerCli(arguments_: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (arguments_.some((argument) => argument !== "--once")) return 2;
  const once = arguments_.includes("--once"), controller = new AbortController();
  const stop = () => controller.abort(new Error("Worker shutdown requested."));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const workerConfig = readSnapshotWorkerConfig(), githubConfig = parseGitHubSnapshotConfig(process.env), db = getDatabase();
    const snapshots = new RepositorySnapshotService(new RepositorySnapshotRepository(db), (input) => {
      const client = new GitHubClient(githubConfig);
      return buildRepositorySnapshot({ ...input, client, config: githubConfig });
    });
    const worker = new SnapshotWorker(new SnapshotJobRepository(db), snapshots, {
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
  runSnapshotWorkerCli().then((code) => { process.exitCode = code; }, () => { process.exitCode = 1; });
}

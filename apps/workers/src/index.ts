import "./load-env.js";
import { startPlanBuildWorker } from "./workers/plan-build.js";
import { startAnalysisWorker } from "./workers/analysis.js";
import { startNodeRunWorker } from "./workers/node-run.js";
import { startIntegrationWorker } from "./workers/integration.js";
import { startReplanWorker } from "./workers/replan.js";
import { closeQueues } from "./queue.js";
import { env } from "./env.js";
import { logger } from "./log.js";

const log = logger("workers");

/**
 * Boot all BullMQ agent workers in one process (the BRAIN of Trellis):
 *   plan-build · analysis · node-run · integration · replan
 *
 * Each worker is independently resilient: a bad job is logged and the durable
 * failure is recorded; the process keeps consuming. We never let one job take
 * the process down.
 */
async function main(): Promise<void> {
  log.info(`starting Trellis workers (backend=${env.executionBackend}, redis=${env.redisUrl})`);

  const workers = [
    startPlanBuildWorker(),
    startAnalysisWorker(),
    startNodeRunWorker(),
    startIntegrationWorker(),
    startReplanWorker(),
  ];

  const shutdown = async (signal: string) => {
    log.info(`received ${signal}; shutting down`);
    await Promise.all(workers.map((w) => w.close().catch(() => {})));
    await closeQueues().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Never crash the process on an unhandled rejection — log and continue.
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection", reason);
  });
  process.on("uncaughtException", (err) => {
    log.error("uncaughtException", err);
  });

  log.info("all five workers running");
}

main().catch((err) => {
  log.error("fatal boot error", err);
  process.exit(1);
});

import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { ApiErrors } from "./errors.js";
import { closeQueues } from "./queue.js";
import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";
import { planRoutes } from "./routes/plans.js";
import { branchRoutes } from "./routes/branches.js";
import { nodeRoutes } from "./routes/nodes.js";
import { shareRoutes } from "./routes/shares.js";
import { runRoutes } from "./routes/runs.js";
import { fileURLToPath } from "node:url";

/**
 * Fastify orchestration API. Validates -> persists (Supabase service role) ->
 * enqueues (BullMQ) -> returns. The long agent work happens in workers and
 * streams back over Redis (SSE) / Supabase Realtime. All routes under /v1.
 */
export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors, {
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : true,
    credentials: true,
  });

  // Uniform error envelope for anything that bubbles up.
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "unhandled route error");
    if (reply.sent) return;
    return ApiErrors.internal(reply, "Unexpected server error");
  });

  app.setNotFoundHandler((_request, reply) => {
    return ApiErrors.notFound(reply, "Route not found");
  });

  // All endpoints live under /v1.
  await app.register(
    async (v1) => {
      await healthRoutes(v1);
      await projectRoutes(v1);
      await planRoutes(v1);
      await branchRoutes(v1);
      await nodeRoutes(v1);
      await shareRoutes(v1);
      await runRoutes(v1);
    },
    { prefix: "/v1" },
  );

  return app;
}

async function start() {
  const app = await buildServer();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      await closeQueues();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: env.apiPort, host: "0.0.0.0" });
    app.log.info(`Trellis API listening on :${env.apiPort} (/v1)`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only auto-start when run directly (not when imported, e.g. by the MCP server).
// Compare decoded paths so it works under tsx and when the repo path has spaces.
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  void start();
}

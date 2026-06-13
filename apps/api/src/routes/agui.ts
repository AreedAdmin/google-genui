import type { FastifyInstance, FastifyReply } from "fastify";
import { keys } from "@trellis/shared";
import { authPreHandler } from "../auth.js";
import { createRedis } from "../queue.js";
import { env } from "../env.js";

/**
 * AG-UI event endpoint (mandated-integrations.md §3.1). Streams standard AG-UI
 * events (RUN_*, STATE_SNAPSHOT, CUSTOM, …) for a plan as Server-Sent Events by
 * tailing the Redis stream `stream:gui:{plan_id}` the workers emit to. CopilotKit
 * / @ag-ui/client consume this to drive the React Flow canvas. The raw token/diff
 * firehose stays on `stream:run:{run_id}` (runs.ts) per the two-plane split.
 *
 * Accepts GET (EventSource) and POST (an AG-UI HttpAgent RunAgentInput body — the
 * body is not needed here; the "run" is the live plan event stream itself).
 */
export async function aguiRoutes(app: FastifyInstance): Promise<void> {
  app.route<{ Params: { id: string }; Querystring: { from?: string } }>({
    method: ["GET", "POST"],
    url: "/plans/:id/agui",
    preHandler: authPreHandler,
    handler: async (request, reply) => {
      const planId = request.params.id;
      const streamKey = keys.guiStream(planId);

      // SSE bypasses Fastify's reply pipeline (raw writeHead), so @fastify/cors
      // can't inject headers — reflect the allowed Origin manually.
      const origin = request.headers.origin;
      const allowOrigin = origin && env.corsOrigins.includes(origin) ? origin : undefined;
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...(allowOrigin
          ? { "Access-Control-Allow-Origin": allowOrigin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" }
          : {}),
      });
      reply.raw.write(`: connected to ${streamKey}\n\n`);

      const redis = createRedis();
      let closed = false;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        redis.disconnect();
        if (!reply.raw.writableEnded) reply.raw.end();
      };
      request.raw.on("close", cleanup);

      const heartbeat = setInterval(() => {
        if (!closed && !reply.raw.writableEnded) reply.raw.write(`: ping\n\n`);
      }, 15000);

      let lastId = request.query.from ?? "$";
      try {
        while (!closed) {
          const result = (await (redis.xread as any)(
            "BLOCK",
            0,
            "COUNT",
            100,
            "STREAMS",
            streamKey,
            lastId,
          )) as Array<[string, Array<[string, string[]]>]> | null;

          if (closed) break;
          if (!result) continue;

          for (const [, entries] of result) {
            for (const [id, fields] of entries) {
              lastId = id;
              writeAgui(reply, id, fields);
            }
          }
        }
      } catch (err) {
        if (!closed) request.log.warn({ err, planId }, "AG-UI stream tail error");
      } finally {
        cleanup();
      }
    },
  });
}

/** Each gui-stream entry stores the full AG-UI event JSON under the `payload` field. */
function writeAgui(reply: FastifyReply, id: string, fields: string[]): void {
  if (reply.raw.writableEnded) return;
  let payload = "{}";
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i] === "payload") payload = fields[i + 1] ?? "{}";
  }
  reply.raw.write(`id: ${id}\n`);
  reply.raw.write(`data: ${payload}\n\n`);
}

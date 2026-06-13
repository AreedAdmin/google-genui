import type { FastifyInstance, FastifyReply } from "fastify";
import { keys } from "@trellis/shared";
import { authPreHandler } from "../auth.js";
import { createRedis } from "../queue.js";
import { env } from "../env.js";

/**
 * SSE relay of the Redis Stream stream:run:{id}. Uses a dedicated blocking
 * connection (XREAD BLOCK) per client and forwards each entry as an SSE event.
 * The connection is torn down when the client disconnects.
 */
export async function runRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { from?: string } }>(
    "/runs/:id/stream",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const runId = request.params.id;
      const streamKey = keys.runStream(runId);

      // Take over the response for manual SSE writes.
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
      // Initial comment flushes headers and primes some proxies.
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

      // Heartbeat comment keeps the connection alive through idle periods.
      const heartbeat = setInterval(() => {
        if (!closed && !reply.raw.writableEnded) reply.raw.write(`: ping\n\n`);
      }, 15000);

      // Start from the caller-supplied id, else only new entries ("$").
      let lastId = request.query.from ?? "$";

      try {
        while (!closed) {
          // XREAD BLOCK 0 COUNT 100 STREAMS <key> <lastId>
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
              writeSse(reply, id, fieldsToObject(fields));
            }
          }
        }
      } catch (err) {
        if (!closed) {
          request.log.warn({ err, runId }, "SSE stream tail error");
          writeSse(reply, "error", { message: "stream_error" });
        }
      } finally {
        cleanup();
      }
    },
  );
}

/** Redis stream fields arrive as a flat [k1, v1, k2, v2, ...] array. */
function fieldsToObject(fields: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    obj[fields[i]!] = fields[i + 1]!;
  }
  return obj;
}

function writeSse(reply: FastifyReply, id: string, data: unknown): void {
  if (reply.raw.writableEnded) return;
  reply.raw.write(`id: ${id}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

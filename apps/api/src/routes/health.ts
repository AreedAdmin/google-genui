import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Public (no auth) liveness probe.
  app.get("/health", async (_request, reply) => {
    return reply.code(200).send({ status: "ok", time: new Date().toISOString() });
  });
}

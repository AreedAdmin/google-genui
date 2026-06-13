import type { FastifyInstance } from "fastify";
import { authPreHandler } from "../auth.js";
import { ApiErrors } from "../errors.js";
import { runBranch } from "../services/runs.js";
import { NotFoundError } from "../services/plans.js";

export async function branchRoutes(app: FastifyInstance): Promise<void> {
  // POST /branches/:id/run — dispatch every node in the branch.
  app.post<{ Params: { id: string } }>(
    "/branches/:id/run",
    { preHandler: authPreHandler },
    async (request, reply) => {
      try {
        const runs = await runBranch(request.identity, request.params.id);
        return reply.code(202).send({ runs });
      } catch (err) {
        if (err instanceof NotFoundError) return ApiErrors.notFound(reply, err.message);
        throw err;
      }
    },
  );
}

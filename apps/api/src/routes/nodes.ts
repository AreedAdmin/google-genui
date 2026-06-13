import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authPreHandler } from "../auth.js";
import { ApiErrors } from "../errors.js";
import { createFeedback } from "../services/feedback.js";
import { getNodeDiff } from "../services/runs.js";

const FeedbackBody = z.object({
  vote: z.enum(["up", "down"]),
  reason: z.string().optional(),
  annotation_path: z.string().optional(),
});

export async function nodeRoutes(app: FastifyInstance): Promise<void> {
  // POST /nodes/:id/feedback — thumbs up/down on an analysis claim.
  app.post<{ Params: { id: string } }>(
    "/nodes/:id/feedback",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const parsed = FeedbackBody.safeParse(request.body);
      if (!parsed.success) return ApiErrors.validationFailed(reply, parsed.error);

      const feedback = await createFeedback(
        request.identity,
        request.params.id,
        parsed.data,
      );
      return reply.code(201).send(feedback);
    },
  );

  // GET /nodes/:id/diff — the latest build run's captured diff (Changes tab).
  app.get<{ Params: { id: string } }>(
    "/nodes/:id/diff",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const diff = await getNodeDiff(request.identity, request.params.id);
      return reply.code(200).send(diff);
    },
  );
}

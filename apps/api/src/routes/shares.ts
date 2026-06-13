import type { FastifyInstance } from "fastify";
import { ShareRequest } from "@trellis/shared";
import { authPreHandler } from "../auth.js";
import { ApiErrors } from "../errors.js";
import { createShare } from "../services/shares.js";

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  app.post("/shares", { preHandler: authPreHandler }, async (request, reply) => {
    const parsed = ShareRequest.safeParse(request.body);
    if (!parsed.success) return ApiErrors.validationFailed(reply, parsed.error);

    const share = await createShare(request.identity, parsed.data);
    return reply.code(201).send(share);
  });
}

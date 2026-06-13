import type { FastifyInstance } from "fastify";
import {
  CreatePlanRequest,
  ReplanRequest,
  RunSelectionRequest,
  DelegateRequest,
} from "@trellis/shared";
import { authPreHandler } from "../auth.js";
import { ApiErrors } from "../errors.js";
import { createPlan, getPlanGraph, replan, listPlans, NotFoundError } from "../services/plans.js";
import { runSelection } from "../services/runs.js";
import { delegateSubtree } from "../services/delegations.js";

export async function planRoutes(app: FastifyInstance): Promise<void> {
  // POST /plans — Flow A.
  app.post("/plans", { preHandler: authPreHandler }, async (request, reply) => {
    const parsed = CreatePlanRequest.safeParse(request.body);
    if (!parsed.success) return ApiErrors.validationFailed(reply, parsed.error);

    try {
      const plan = await createPlan(request.identity, parsed.data);
      return reply.code(201).send({ plan_id: plan.id });
    } catch (err) {
      if (err instanceof NotFoundError) return ApiErrors.notFound(reply, err.message);
      throw err;
    }
  });

  // GET /plans — list the caller's plans (home "recent plans").
  app.get("/plans", { preHandler: authPreHandler }, async (request, reply) => {
    const plans = await listPlans(request.identity);
    return reply.code(200).send(plans);
  });

  // GET /plans/:id — assemble a PlanGraph.
  app.get<{ Params: { id: string } }>(
    "/plans/:id",
    { preHandler: authPreHandler },
    async (request, reply) => {
      try {
        const graph = await getPlanGraph(request.identity, request.params.id);
        return reply.code(200).send(graph);
      } catch (err) {
        if (err instanceof NotFoundError) return ApiErrors.notFound(reply, err.message);
        throw err;
      }
    },
  );

  // POST /plans/:id/replan — Flow C.
  app.post<{ Params: { id: string } }>(
    "/plans/:id/replan",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const parsed = ReplanRequest.safeParse(request.body);
      if (!parsed.success) return ApiErrors.validationFailed(reply, parsed.error);

      try {
        const result = await replan(request.identity, request.params.id, parsed.data);
        return reply.code(202).send(result);
      } catch (err) {
        if (err instanceof NotFoundError) return ApiErrors.notFound(reply, err.message);
        throw err;
      }
    },
  );

  // POST /plans/:id/run — run a selection of nodes / branches.
  app.post<{ Params: { id: string } }>(
    "/plans/:id/run",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const parsed = RunSelectionRequest.safeParse(request.body ?? {});
      if (!parsed.success) return ApiErrors.validationFailed(reply, parsed.error);

      try {
        const runs = await runSelection(request.identity, request.params.id, parsed.data);
        return reply.code(202).send({ runs });
      } catch (err) {
        if (err instanceof NotFoundError) return ApiErrors.notFound(reply, err.message);
        throw err;
      }
    },
  );

  // POST /plans/:id/delegate — Flow D.
  app.post<{ Params: { id: string } }>(
    "/plans/:id/delegate",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const parsed = DelegateRequest.safeParse(request.body);
      if (!parsed.success) return ApiErrors.validationFailed(reply, parsed.error);

      try {
        const delegation = await delegateSubtree(
          request.identity,
          request.params.id,
          parsed.data,
        );
        return reply.code(201).send(delegation);
      } catch (err) {
        if (err instanceof NotFoundError) return ApiErrors.notFound(reply, err.message);
        throw err;
      }
    },
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authPreHandler } from "../auth.js";
import { ApiErrors } from "../errors.js";
import { createProject, listProjects } from "../services/projects.js";

const CreateProjectBody = z.object({
  name: z.string().min(1),
  repo_url: z.string().min(1),
  provider: z.string().optional(),
  default_branch: z.string().optional(),
  languages: z.array(z.string()).optional(),
});

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.post("/projects", { preHandler: authPreHandler }, async (request, reply) => {
    const parsed = CreateProjectBody.safeParse(request.body);
    if (!parsed.success) return ApiErrors.validationFailed(reply, parsed.error);

    const project = await createProject(request.identity, parsed.data);
    return reply.code(201).send(project);
  });

  app.get("/projects", { preHandler: authPreHandler }, async (request, reply) => {
    const projects = await listProjects(request.identity);
    return reply.code(200).send({ data: projects });
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authPreHandler } from "../auth.js";
import { ApiErrors } from "../errors.js";
import { createProject, listProjects, getProject } from "../services/projects.js";
import { validateRepoConnection, listAccessibleRepos } from "../services/github-validate.js";

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

    // Pre-flight: confirm the repo + branch are reachable so we don't silently
    // degrade to the sample repo at plan-build time.
    const validation = await validateRepoConnection(parsed.data.repo_url, parsed.data.default_branch);
    if (!validation.ok) return ApiErrors.badRequest(reply, validation.error ?? "Repository could not be reached");

    const project = await createProject(request.identity, {
      ...parsed.data,
      default_branch: parsed.data.default_branch ?? validation.defaultBranch,
    });
    return reply.code(201).send(project);
  });

  app.get("/projects", { preHandler: authPreHandler }, async (request, reply) => {
    const projects = await listProjects(request.identity);
    return reply.code(200).send({ data: projects });
  });

  app.get<{ Params: { id: string } }>(
    "/projects/:id",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const project = await getProject(request.identity, request.params.id);
      if (!project) return ApiErrors.notFound(reply, "Project not found");
      return reply.code(200).send(project);
    },
  );

  // Repos the configured GITHUB_TOKEN can access — powers the connect-repo dropdown.
  app.get("/github/repos", { preHandler: authPreHandler }, async (_request, reply) => {
    const result = await listAccessibleRepos();
    return reply.code(200).send(result);
  });
}

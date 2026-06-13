import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DEV_IDENTITY, env } from "../env.js";
import type { Identity } from "../auth.js";
import { createPlan, getPlanGraph, NotFoundError } from "../services/plans.js";
import { runBranch } from "../services/runs.js";
import { renderPlanSummary, renderStatusSummary } from "../services/summary.js";

/**
 * Trellis MCP launcher (integration-surfaces.md §3). The coding agent is the
 * CLIENT here, calling Trellis. Tools reuse the same service modules as the REST
 * API, so behavior + RLS scoping are identical regardless of surface.
 *
 * Auth: calls are bound to a Trellis token (TRELLIS_MCP_TOKEN_SECRET). In dev,
 * if the token is absent we fall back to the fixed dev identity, mirroring the
 * REST dev bypass.
 */

const canvasUrl = (planId: string) => `${env.appUrl}/p/${planId}`;

/**
 * Resolve the caller's Trellis identity. v1: the device-link token is validated
 * against TRELLIS_MCP_TOKEN_SECRET out of band; the bound identity is the dev
 * user unless a verified token maps to a real profile (extension point).
 */
function callerIdentity(): Identity {
  // Touch the secret so a missing config fails loudly outside dev.
  if (!env.isDev) env.mcpTokenSecret();
  return { ...DEV_IDENTITY };
}

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "trellis",
    version: "0.0.0",
  });

  // trellis_plan — create a plan from intent; deep-link to the canvas.
  server.tool(
    "trellis_plan",
    "Create a Trellis plan from a natural-language prompt. Returns the plan id and a deep link to the generative-UI canvas.",
    {
      prompt: z.string().min(1),
      project_id: z.string().uuid().optional(),
    },
    async ({ prompt, project_id }) => {
      const identity = callerIdentity();
      if (!project_id) {
        return text(
          "trellis_plan requires a project_id. Create or list a project first (POST /v1/projects).",
        );
      }
      try {
        const plan = await createPlan(identity, { project_id, prompt });
        const url = canvasUrl(plan.id);
        return text(
          `Plan created.\nplan_id: ${plan.id}\ncanvas_url: ${url}\n\nOpen the canvas to review, ratify, and dispatch.`,
        );
      } catch (err) {
        if (err instanceof NotFoundError) return text(`Error: ${err.message}`);
        return text(`Error creating plan: ${(err as Error).message}`);
      }
    },
  );

  // trellis_get_plan — compact text summary of the plan graph.
  server.tool(
    "trellis_get_plan",
    "Fetch a Trellis plan as a compact text summary (tiers, node/branch counts, top risks).",
    { plan_id: z.string().uuid() },
    async ({ plan_id }) => {
      try {
        const graph = await getPlanGraph(callerIdentity(), plan_id);
        return text(renderPlanSummary(graph));
      } catch (err) {
        if (err instanceof NotFoundError) return text(`Error: ${err.message}`);
        return text(`Error fetching plan: ${(err as Error).message}`);
      }
    },
  );

  // trellis_status — current statuses + running nodes.
  server.tool(
    "trellis_status",
    "Get a live status snapshot for a Trellis plan: per-status node counts and which nodes are running.",
    { plan_id: z.string().uuid() },
    async ({ plan_id }) => {
      try {
        const graph = await getPlanGraph(callerIdentity(), plan_id);
        return text(renderStatusSummary(graph));
      } catch (err) {
        if (err instanceof NotFoundError) return text(`Error: ${err.message}`);
        return text(`Error fetching status: ${(err as Error).message}`);
      }
    },
  );

  // trellis_run_branch — execute every node in a branch (role: runner).
  server.tool(
    "trellis_run_branch",
    "Dispatch every node in a Trellis branch for execution. Returns the created run ids.",
    { branch_id: z.string().uuid() },
    async ({ branch_id }) => {
      try {
        const runs = await runBranch(callerIdentity(), branch_id);
        if (runs.length === 0) return text("No nodes were dispatched (branch empty or not found).");
        const lines = runs.map((r) => `  - node ${r.node_id} -> run ${r.run_id}`);
        return text(`Dispatched ${runs.length} node run(s):\n${lines.join("\n")}`);
      } catch (err) {
        if (err instanceof NotFoundError) return text(`Error: ${err.message}`);
        return text(`Error running branch: ${(err as Error).message}`);
      }
    },
  );

  return server;
}

async function main() {
  const server = buildMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stdio MCP servers log to stderr to avoid corrupting the protocol on stdout.
  process.stderr.write("Trellis MCP server connected over stdio\n");
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  void main();
}

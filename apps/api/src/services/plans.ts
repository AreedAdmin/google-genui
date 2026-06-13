import { QUEUES, type PlanGraph } from "@trellis/shared";
import type { CreatePlanRequest, ReplanRequest } from "@trellis/shared";
import type { Identity } from "../auth.js";
import { db } from "../supabase.js";
import { getQueue } from "../queue.js";

/**
 * Plan service — Flow A (create), the PlanGraph assembler, and Flow C (replan).
 * Shared by the REST routes and the MCP launcher so both paths behave identically.
 */

export class NotFoundError extends Error {}

/**
 * Flow A: insert a plan (status=planning) and enqueue queue:plan-build. The
 * worker runs Planner -> Dependency engine -> persists nodes/edges/branches.
 */
export async function createPlan(identity: Identity, input: CreatePlanRequest) {
  // Ensure the project belongs to the caller's org (scoped, service-role bypasses RLS).
  const { data: project, error: projErr } = await db()
    .from("projects")
    .select("id, org_id")
    .eq("id", input.project_id)
    .eq("org_id", identity.orgId)
    .maybeSingle();
  if (projErr) throw new Error(`createPlan project lookup failed: ${projErr.message}`);
  if (!project) throw new NotFoundError("Project not found");

  const { data: plan, error } = await db()
    .from("plans")
    .insert({
      project_id: input.project_id,
      title: input.prompt.slice(0, 120),
      prompt: input.prompt,
      granularity: input.granularity ?? "g2_meso",
      status: "planning",
      current_revision: 1,
      created_by: identity.userId,
    })
    .select("*")
    .single();

  if (error) throw new Error(`createPlan insert failed: ${error.message}`);

  await getQueue(QUEUES.planBuild).add(
    "plan-build",
    { plan_id: plan.id },
    { jobId: `plan-build-${plan.id}` },
  );

  return plan;
}

export interface PlanSummary {
  id: string;
  project_id: string;
  title: string;
  prompt: string;
  granularity: string;
  status: string;
  node_count: number;
  updated_at: string;
}

/**
 * List the caller's plans (org-scoped via their projects), newest first, with a
 * node count per plan. Powers the home "recent plans" list (GET /v1/plans).
 */
export async function listPlans(identity: Identity): Promise<PlanSummary[]> {
  const sb = db();
  const { data: projects, error: projErr } = await sb
    .from("projects")
    .select("id")
    .eq("org_id", identity.orgId);
  if (projErr) throw new Error(`listPlans projects failed: ${projErr.message}`);
  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length === 0) return [];

  const { data: plans, error } = await sb
    .from("plans")
    .select("id, project_id, title, prompt, granularity, status, current_revision, updated_at, created_at")
    .in("project_id", projectIds)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`listPlans failed: ${error.message}`);

  const summaries: PlanSummary[] = [];
  for (const plan of plans ?? []) {
    const { count } = await sb
      .from("plan_nodes")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", plan.id)
      .eq("revision", plan.current_revision ?? 1);
    summaries.push({
      id: plan.id,
      project_id: plan.project_id,
      title: plan.title,
      prompt: plan.prompt,
      granularity: plan.granularity,
      status: plan.status,
      node_count: count ?? 0,
      updated_at: plan.updated_at ?? plan.created_at,
    });
  }
  return summaries;
}

/**
 * Assemble a full PlanGraph (plan + nodes + edges + branches + annotations) for
 * a plan's current revision. Throws NotFoundError if the plan is hidden/absent.
 */
export async function getPlanGraph(
  identity: Identity,
  planId: string,
): Promise<PlanGraph> {
  const sb = db();

  const { data: plan, error: planErr } = await sb
    .from("plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  if (planErr) throw new Error(`getPlanGraph plan failed: ${planErr.message}`);
  if (!plan) throw new NotFoundError("Plan not found");

  // Org scoping: confirm the plan's project is in the caller's org.
  const { data: project, error: projErr } = await sb
    .from("projects")
    .select("id, org_id")
    .eq("id", plan.project_id)
    .maybeSingle();
  if (projErr) throw new Error(`getPlanGraph project failed: ${projErr.message}`);
  if (!project || project.org_id !== identity.orgId) {
    // Do not leak existence to out-of-org callers.
    throw new NotFoundError("Plan not found");
  }

  const revision = plan.current_revision ?? 1;

  const [nodesRes, edgesRes, branchesRes] = await Promise.all([
    sb.from("plan_nodes").select("*").eq("plan_id", planId).eq("revision", revision),
    sb.from("plan_edges").select("*").eq("plan_id", planId).eq("revision", revision),
    sb.from("branches").select("*").eq("plan_id", planId),
  ]);

  if (nodesRes.error) throw new Error(`getPlanGraph nodes failed: ${nodesRes.error.message}`);
  if (edgesRes.error) throw new Error(`getPlanGraph edges failed: ${edgesRes.error.message}`);
  if (branchesRes.error)
    throw new Error(`getPlanGraph branches failed: ${branchesRes.error.message}`);

  const nodes = nodesRes.data ?? [];
  const nodeIds = nodes.map((n) => n.id);
  // Branches aren't revision-scoped in the schema; keep only those referenced by
  // THIS revision's nodes so a re-plan doesn't leak stale branches onto the canvas.
  const liveBranchIds = new Set(nodes.map((n) => n.branch_id).filter(Boolean));
  const branches = (branchesRes.data ?? []).filter((b) => liveBranchIds.has(b.id));

  let annotations: unknown[] = [];
  if (nodeIds.length > 0) {
    const annRes = await sb
      .from("node_annotations")
      .select("*")
      .in("node_id", nodeIds)
      .eq("revision", revision);
    if (annRes.error)
      throw new Error(`getPlanGraph annotations failed: ${annRes.error.message}`);
    annotations = annRes.data ?? [];
  }

  return {
    plan,
    nodes,
    edges: edgesRes.data ?? [],
    branches,
    annotations,
  } as PlanGraph;
}

/**
 * Flow C: enqueue queue:replan with the added context. The Replan worker writes
 * a plan_revisions row, re-derives dependencies, and bumps current_revision.
 * Returns the new (target) revision number.
 */
export async function replan(
  identity: Identity,
  planId: string,
  input: ReplanRequest,
): Promise<{ revision: number }> {
  // Confirm access + read current revision.
  const graph = await getPlanGraph(identity, planId);
  const nextRevision = (graph.plan.current_revision ?? 1) + 1;

  await getQueue(QUEUES.replan).add("replan", {
    plan_id: planId,
    context: input.context,
    target_revision: nextRevision,
  });

  return { revision: nextRevision };
}

import { QUEUES, keys, type RunSelectionRequest } from "@trellis/shared";
import type { Identity } from "../auth.js";
import { db } from "../supabase.js";
import { getQueue } from "../queue.js";
import { getPlanGraph, NotFoundError } from "./plans.js";

/**
 * Run dispatch service — creates `runs` rows (kind=node_build, status=queued)
 * and enqueues queue:node-run per node. Used by plan run-selection and branch run.
 */

export interface CreatedRun {
  run_id: string;
  node_id: string;
}

/** Insert a queued node_build run and enqueue it. Returns {run_id, node_id}. */
async function dispatchNode(
  planId: string,
  nodeId: string,
  branchId: string | null,
): Promise<CreatedRun> {
  const { data: run, error } = await db()
    .from("runs")
    .insert({
      plan_id: planId,
      node_id: nodeId,
      branch_id: branchId,
      kind: "node_build",
      status: "queued",
    })
    .select("id")
    .single();
  if (error) throw new Error(`dispatchNode insert failed: ${error.message}`);

  const runId = run.id as string;

  // Stamp the run's log stream key so the SSE tail and worker agree.
  const streamKey = keys.runStream(runId);
  await db().from("runs").update({ logs_stream_key: streamKey }).eq("id", runId);

  await getQueue(QUEUES.nodeRun).add(
    "node-run",
    { node_id: nodeId, run_id: runId, plan_id: planId },
    { jobId: `node-run-${runId}` },
  );

  return { run_id: runId, node_id: nodeId };
}

/**
 * Run a selection of nodes and/or branches on a plan. If branch_ids are given,
 * each branch is expanded to its member nodes. Returns the created run ids.
 */
export async function runSelection(
  identity: Identity,
  planId: string,
  input: RunSelectionRequest,
): Promise<CreatedRun[]> {
  // Access check + load the graph so we can resolve branch -> nodes and find
  // each node's branch_id.
  const graph = await getPlanGraph(identity, planId);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const branchById = new Map(graph.branches.map((b) => [b.id, b]));

  // Collect node ids: explicit nodes + nodes expanded from each branch.
  const targetNodeIds = new Set<string>();
  for (const id of input.node_ids ?? []) {
    if (nodeById.has(id)) targetNodeIds.add(id);
  }
  for (const branchId of input.branch_ids ?? []) {
    const branch = branchById.get(branchId);
    if (!branch) continue;
    for (const nid of branch.node_ids) {
      if (nodeById.has(nid)) targetNodeIds.add(nid);
    }
  }

  const created: CreatedRun[] = [];
  for (const nodeId of targetNodeIds) {
    const node = nodeById.get(nodeId)!;
    created.push(await dispatchNode(planId, nodeId, node.branch_id ?? null));
  }
  return created;
}

/**
 * Run every node in a branch. Resolves the branch -> its plan, then dispatches
 * each member node. Returns the created run ids.
 */
export async function runBranch(
  identity: Identity,
  branchId: string,
): Promise<CreatedRun[]> {
  const { data: branch, error } = await db()
    .from("branches")
    .select("id, plan_id, node_ids")
    .eq("id", branchId)
    .maybeSingle();
  if (error) throw new Error(`runBranch lookup failed: ${error.message}`);
  if (!branch) throw new NotFoundError("Branch not found");

  // Access check (also confirms the plan's project is in the caller's org).
  const graph = await getPlanGraph(identity, branch.plan_id);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const created: CreatedRun[] = [];
  for (const nodeId of branch.node_ids as string[]) {
    if (!nodeById.has(nodeId)) continue;
    created.push(await dispatchNode(branch.plan_id, nodeId, branchId));
  }
  return created;
}

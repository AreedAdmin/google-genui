import type { DelegateRequest } from "@trellis/shared";
import type { Identity } from "../auth.js";
import { db } from "../supabase.js";
import { getPlanGraph, NotFoundError } from "./plans.js";

/**
 * Delegation service — Flow D. Serializes a subtree (root node + descendants via
 * depends_on/sequence edges) into a portable spec, writes it to the `specs`
 * Storage bucket, inserts a `delegations` row (status=sent), and creates a
 * paired `shares` grant so the recipient can open it.
 */

const SPECS_BUCKET = "specs";

/** BFS the edge set forward from the root to gather the subtree node ids. */
function subtreeNodeIds(
  rootNodeId: string,
  edges: Array<{ from_node: string; to_node: string }>,
): Set<string> {
  // Edges point from a node to the node that depends on / follows it; we walk
  // outward from the root following from_node -> to_node to collect descendants.
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.from_node) ?? [];
    list.push(e.to_node);
    adjacency.set(e.from_node, list);
  }

  const visited = new Set<string>([rootNodeId]);
  const stack = [rootNodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const next of adjacency.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        stack.push(next);
      }
    }
  }
  return visited;
}

export async function delegateSubtree(
  identity: Identity,
  planId: string,
  input: DelegateRequest,
) {
  const sb = db();

  // Access check + load graph (org-scoped via getPlanGraph).
  const graph = await getPlanGraph(identity, planId);

  const root = graph.nodes.find((n) => n.id === input.subtree_root_node);
  if (!root) throw new NotFoundError("subtree_root_node not found in plan");

  // Compute the subtree.
  const ids = subtreeNodeIds(input.subtree_root_node, graph.edges);
  const nodes = graph.nodes.filter((n) => ids.has(n.id));
  const edges = graph.edges.filter((e) => ids.has(e.from_node) && ids.has(e.to_node));
  const annotations = (graph.annotations as Array<{ node_id: string }>).filter((a) =>
    ids.has(a.node_id),
  );

  // 1) Insert the delegation row (status=sent).
  const { data: delegation, error: delErr } = await sb
    .from("delegations")
    .insert({
      plan_id: planId,
      subtree_root_node: input.subtree_root_node,
      assigned_to_user: input.assigned_to_user ?? null,
      assigned_to_email: input.assigned_to_email ?? null,
      role: input.role,
      status: "sent",
      base_commit: graph.plan.base_commit ?? "",
      created_by: identity.userId,
    })
    .select("*")
    .single();
  if (delErr) throw new Error(`delegate insert failed: ${delErr.message}`);

  // 2) Build the portable spec and upload to the `specs` bucket.
  const spec = {
    version: 1,
    delegation_id: delegation.id,
    plan_id: planId,
    subtree_root_node: input.subtree_root_node,
    base_commit: graph.plan.base_commit ?? "",
    granularity: graph.plan.granularity,
    nodes,
    edges,
    annotations,
    created_at: new Date().toISOString(),
  };

  const specPath = `${planId}/${delegation.id}.json`;
  const { error: uploadErr } = await sb.storage
    .from(SPECS_BUCKET)
    .upload(specPath, JSON.stringify(spec, null, 2), {
      contentType: "application/json",
      upsert: true,
    });
  if (uploadErr) throw new Error(`spec upload failed: ${uploadErr.message}`);

  // 3) Set spec_path on the delegation row.
  const { data: updated, error: updErr } = await sb
    .from("delegations")
    .update({ spec_path: specPath })
    .eq("id", delegation.id)
    .select("*")
    .single();
  if (updErr) throw new Error(`delegate spec_path update failed: ${updErr.message}`);

  // 4) Create a paired `shares` grant so the recipient can open the plan.
  const { error: shareErr } = await sb.from("shares").insert({
    resource_type: "plan",
    resource_id: planId,
    principal_user: input.assigned_to_user ?? null,
    principal_email: input.assigned_to_email ?? null,
    role: input.role,
    created_by: identity.userId,
  });
  if (shareErr) throw new Error(`delegate share insert failed: ${shareErr.message}`);

  return updated;
}

import type { PlanGraph } from "@trellis/shared";

/**
 * Compact text renderers for the MCP launcher — tiers, node/branch counts,
 * independent branches, and top risks. The DAG itself lives in the canvas; these
 * are summaries + monitors, never a terminal redraw (integration-surfaces.md §4).
 */

/** A full plan summary (trellis_get_plan). */
export function renderPlanSummary(graph: PlanGraph): string {
  const { plan, nodes, edges, branches } = graph;

  const independentBranches = branches.filter(
    (b) => (b.independent_of?.length ?? 0) > 0 || b.status === "ready",
  ).length;

  const lines: string[] = [];
  lines.push(`Plan: ${plan.title}`);
  lines.push(`Status: ${plan.status}  ·  Granularity: ${plan.granularity}  ·  Revision: ${plan.current_revision}`);
  lines.push(`Nodes: ${nodes.length}  ·  Edges: ${edges.length}  ·  Branches: ${branches.length} (${independentBranches} independent)`);

  if (branches.length > 0) {
    lines.push("");
    lines.push("Branches:");
    for (const b of branches) {
      lines.push(`  - ${b.label} [${b.status}] (${b.node_ids.length} nodes)`);
    }
  }

  const risks = collectRisks(graph);
  if (risks.length > 0) {
    lines.push("");
    lines.push("Top risks:");
    for (const r of risks.slice(0, 5)) lines.push(`  - ${r}`);
  }

  return lines.join("\n");
}

/** A live-status snapshot (trellis_status) — current statuses + running nodes. */
export function renderStatusSummary(graph: PlanGraph): string {
  const { plan, nodes } = graph;

  const byStatus = new Map<string, number>();
  for (const n of nodes) byStatus.set(n.status, (byStatus.get(n.status) ?? 0) + 1);

  const running = nodes.filter((n) => n.status === "running").map((n) => n.title);

  const lines: string[] = [];
  lines.push(`Plan ${plan.id} — ${plan.status}`);
  lines.push(
    "Node statuses: " +
      [...byStatus.entries()].map(([s, c]) => `${s}=${c}`).join(", "),
  );
  if (running.length > 0) {
    lines.push("Running now:");
    for (const t of running) lines.push(`  - ${t}`);
  } else {
    lines.push("No nodes currently running.");
  }
  return lines.join("\n");
}

function collectRisks(graph: PlanGraph): string[] {
  const risks: string[] = [];
  for (const ann of graph.annotations as Array<{
    analysis?: Array<{ severity?: string; text?: string }>;
  }>) {
    for (const item of ann.analysis ?? []) {
      if (item.severity === "high" && item.text) risks.push(item.text);
    }
  }
  return risks;
}

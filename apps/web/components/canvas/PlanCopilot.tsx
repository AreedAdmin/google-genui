"use client";

import { useCopilotReadable, useCopilotAction } from "@copilotkit/react-core";
import { CopilotPopup } from "@copilotkit/react-ui";
import type { PlanGraph } from "@trellis/shared";
import { useReplan } from "@/lib/hooks";

/**
 * PlanCopilot — the mandate's ONE sanctioned chat use (mandated-integrations.md §6):
 * a thin popup for *conversational plan iteration*, not a chat-first UX (the canvas
 * stays primary). It uses CopilotKit headlessly:
 *  - `useCopilotReadable` exposes the live plan graph so the copilot can answer
 *    questions about nodes/branches/risks;
 *  - `useCopilotAction("revise_plan")` lets the model reshape the plan in plain
 *    language → calls POST /plans/:id/replan (the existing replan worker) → the
 *    canvas re-flows to a new revision.
 * Talks to the CopilotRuntime at /v1/copilotkit (apps/api/src/routes/copilotkit.ts).
 */
export function PlanCopilot({
  planId,
  graph,
  selectedNodeId,
}: {
  planId: string;
  graph?: PlanGraph;
  selectedNodeId: string | null;
}) {
  const replan = useReplan(planId);

  useCopilotReadable({
    description:
      "The code-change PLAN the user is viewing: title/status and its nodes (id, title, change_type, status) and branches. Use this to answer questions and to phrase revise_plan instructions.",
    value: graph
      ? {
          title: graph.plan.title,
          status: graph.plan.status,
          granularity: graph.plan.granularity,
          revision: graph.plan.current_revision,
          nodes: graph.nodes.map((n) => ({ id: n.id, title: n.title, change_type: n.change_type, status: n.status })),
          branches: graph.branches.map((b) => ({
            label: b.label,
            node_ids: b.node_ids,
            independent: b.independent_of.length > 0,
          })),
          selectedNodeId,
        }
      : { status: "loading" },
  });

  useCopilotAction({
    name: "revise_plan",
    description:
      "Revise the current plan from a natural-language instruction (split a node, defer or remove work, add a step, re-scope). Re-runs the planner; the canvas re-flows to a new revision. Use this whenever the user asks to change the plan.",
    parameters: [
      {
        name: "instruction",
        type: "string",
        description: "What to change about the plan, in plain language.",
        required: true,
      },
    ],
    handler: async ({ instruction }) => {
      await replan.mutateAsync(String(instruction));
      return `Re-planning with: "${instruction}". The canvas will update to a new revision shortly.`;
    },
  });

  return (
    <CopilotPopup
      instructions={
        "You help the user iterate on a code-change PLAN — a dependency graph of change nodes. " +
        "Use the readable plan context to answer questions about nodes, branches, and risks. " +
        "When the user wants to change the plan, call the revise_plan action with a single clear instruction. " +
        "Keep replies concise; the React Flow canvas (not chat) is the primary surface."
      }
      labels={{
        title: "Plan copilot",
        initial:
          "Ask me to reshape the plan — e.g. “split the OAuth node into config + callback” or “defer auth to a later milestone.”",
      }}
      clickOutsideToClose
    />
  );
}

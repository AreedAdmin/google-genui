"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HttpAgent } from "@ag-ui/client";
import type { StateSnapshotEvent, CustomEvent as AGUICustomEvent } from "@ag-ui/core";
import type { PlanGraph } from "@trellis/shared";
import { API_URL } from "./api";

/**
 * useAgentStream — subscribes to a plan's AG-UI event stream
 * (POST /v1/plans/:id/agui) via @ag-ui/client's `HttpAgent`, and projects the
 * agent's state onto the React Query plan cache (["plan", planId]) → React Flow
 * re-renders. This is the headless, **canvas-primary** AG-UI integration
 * (mandated-integrations.md §3.1 / §6): the agent's *state* draws the graph; there
 * is no chat UI.
 *
 * Additive + best-effort: Supabase Realtime remains the durable, multi-user truth
 * plane (usePlanGraph), so a stream failure never breaks the canvas. Only
 * STATE_SNAPSHOT (full graph) and CUSTOM `node_status` are projected here; richer
 * STATE_DELTA handling is the documented next step.
 */
export function useAgentStream(planId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    const agent = new HttpAgent({ url: `${API_URL}/v1/plans/${planId}/agui` });

    void agent
      .runAgent(
        {},
        {
          onStateSnapshotEvent: ({ event }: { event: StateSnapshotEvent }) => {
            if (cancelled) return;
            const snapshot = event.snapshot as Partial<PlanGraph> | undefined;
            if (snapshot?.plan) {
              queryClient.setQueryData<PlanGraph>(["plan", planId], (prev) => ({
                ...(prev as PlanGraph),
                ...(snapshot as PlanGraph),
              }));
            }
          },
          onCustomEvent: ({ event }: { event: AGUICustomEvent }) => {
            if (cancelled) return;
            if (event.name !== "node_status") return;
            const { node_id, status } = (event.value ?? {}) as { node_id?: string; status?: string };
            if (!node_id || !status) return;
            queryClient.setQueryData<PlanGraph>(["plan", planId], (prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                nodes: prev.nodes.map((n) => (n.id === node_id ? { ...n, status: status as typeof n.status } : n)),
              };
            });
          },
        },
      )
      .catch(() => {
        /* best-effort: the canvas still works via REST + Supabase Realtime */
      });

    return () => {
      cancelled = true;
      try {
        agent.abortRun();
      } catch {
        /* ignore */
      }
    };
  }, [planId, queryClient]);
}

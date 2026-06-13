"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import type { PlanGraph } from "@trellis/shared";
import { api, type PlanListItem, type ProjectListItem, type AccessibleRepo } from "./api";
import { getAccessToken, subscribePlanRealtime } from "./supabase";
import { getFixturePlan, FIXTURE_PLAN_LIST } from "./fixtures";
import { useCanvasStore } from "./store";

/**
 * Data hooks: react-query for server state, with a graceful fixture fallback so
 * the generative-UI surface renders end-to-end even with no live API
 * (genui-philosophy.md — deterministic render from a validated spec).
 */

export function usePlanList() {
  return useQuery<PlanListItem[]>({
    queryKey: ["plans"],
    queryFn: async () => {
      try {
        const token = await getAccessToken();
        const plans = await api.listPlans(token);
        return plans.length ? plans : FIXTURE_PLAN_LIST;
      } catch {
        return FIXTURE_PLAN_LIST;
      }
    },
    staleTime: 15_000,
  });
}

/** Projects (connected repos) for the active org. Empty list on API failure. */
export function useProjects() {
  return useQuery<ProjectListItem[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      try {
        const token = await getAccessToken();
        return await api.listProjects(token);
      } catch {
        return [];
      }
    },
    staleTime: 30_000,
  });
}

/** Connect a new repo (POST /v1/projects); the server validates it before saving. */
export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; repo_url: string; default_branch?: string }) => {
      const token = await getAccessToken();
      return api.createProject(body, token);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

/** Repos the configured GITHUB_TOKEN can access — for the connect-repo dropdown. */
export function useGithubRepos() {
  return useQuery<{ authenticated: boolean; repos: AccessibleRepo[] }>({
    queryKey: ["github-repos"],
    queryFn: async () => {
      try {
        const token = await getAccessToken();
        return await api.listGithubRepos(token);
      } catch {
        return { authenticated: false, repos: [] };
      }
    },
    staleTime: 60_000,
  });
}

export function usePlanGraph(planId: string) {
  const queryClient = useQueryClient();

  const query = useQuery<PlanGraph>({
    queryKey: ["plan", planId],
    queryFn: async () => {
      try {
        const token = await getAccessToken();
        return await api.getPlan(planId, token);
      } catch (err) {
        const fixture = getFixturePlan(planId);
        if (fixture) return fixture;
        throw err;
      }
    },
    staleTime: 5_000,
  });

  // Wire Supabase Realtime → invalidate on durable changes (graph-canvas.md §7).
  useEffect(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ["plan", planId] });
    const unsub = subscribePlanRealtime(planId, {
      onNodeChange: invalidate,
      onRunChange: invalidate,
      onEdgeChange: invalidate,
      onBranchChange: invalidate,
    });
    return unsub;
  }, [planId, queryClient]);

  return query;
}

export function useReplan(planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (context: string) => {
      const token = await getAccessToken();
      return api.replan(planId, { context }, token);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plan", planId] }),
  });
}

export function useRunNodes(planId: string) {
  const queryClient = useQueryClient();
  const setRunProgress = useCanvasStore((s) => s.setRunProgress);
  return useMutation({
    mutationFn: async (selection: { node_ids?: string[]; branch_ids?: string[] }) => {
      const token = await getAccessToken();
      return api.run(planId, selection, token);
    },
    onMutate: (selection) => {
      // optimistic: flip selected nodes into a queued run overlay
      for (const id of selection.node_ids ?? []) {
        setRunProgress(id, { runId: `optimistic-${id}`, status: "queued", progress: 0.02 });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["plan", planId] }),
  });
}

export function useDelegate(planId: string) {
  return useMutation({
    mutationFn: async (body: { subtree_root_node: string; assigned_to_email?: string; role: "viewer" | "runner" | "editor" }) => {
      const token = await getAccessToken();
      return api.delegate(planId, body, token);
    },
  });
}

export function useShare() {
  return useMutation({
    mutationFn: async (body: {
      resource_type: "plan" | "project";
      resource_id: string;
      principal_email?: string;
      role: "viewer" | "runner" | "editor";
    }) => {
      const token = await getAccessToken();
      return api.share(body, token);
    },
  });
}

export function useFeedback() {
  return useMutation({
    mutationFn: async (body: { node_id: string; annotation_path: string; vote: "up" | "down"; reason?: string }) => {
      const token = await getAccessToken();
      try {
        return await api.feedback(body, token);
      } catch {
        // Feedback is best-effort; never block the UI on it.
        return { ok: true as const };
      }
    },
  });
}

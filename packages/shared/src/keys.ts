/**
 * Redis key + queue name builders — plan/01-architecture/data-model.md §6.
 * Single source of truth so api/workers/analysis never hand-roll keys.
 */

// NOTE: BullMQ queue names must NOT contain ':' (it namespaces Redis keys with it).
export const QUEUES = {
  planBuild: "plan-build",
  nodeRun: "node-run",
  analysis: "analysis-jobs",
  integration: "integration",
  replan: "replan",
} as const;

export const keys = {
  symbolGraph: (project: string, commit: string) => `cache:symbolgraph:${project}:${commit}`,
  touchSet: (node: string, rev: number) => `cache:touchset:${node}:${rev}`,
  lockPlan: (id: string) => `lock:plan:${id}`,
  lockBranch: (id: string) => `lock:branch:${id}`,
  lockNode: (id: string) => `lock:node:${id}`,
  lockFile: (project: string, path: string) => `lock:file:${project}:${path}`,
  runStream: (runId: string) => `stream:run:${runId}`,
  presence: (planId: string) => `presence:plan:${planId}`,
};

import { z } from "zod";

/**
 * Runner contract — plan/02-agent-system/agent-runners.md.
 * Orchestration owns safety (worktree isolation, drift audit, test gate);
 * a runner only writes code in the worktree, given a WorkOrder, emitting
 * RunnerEvents and returning a RunnerResult. Claude Code is the v1 runner.
 */

export const WorkOrder = z.object({
  run_id: z.string().uuid(),
  node_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  revision: z.number().int(),
  base_commit: z.string(),
  /** Pre-created, isolated, sandboxed git worktree the runner edits. */
  worktree_path: z.string(),
  goal: z.string(),
  changes: z.array(z.any()).default([]),
  /** The guardrail from the dependency engine. */
  touch_set: z.object({
    allowed_files: z.array(z.string()).default([]),
    allowed_symbols: z.array(z.string()).default([]),
    signatures: z.array(z.string()).default([]),
  }),
  assumptions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  acceptance: z
    .object({
      tests: z.array(z.string()).default([]),
      commands: z.array(z.string()).default([]),
    })
    .default({ tests: [], commands: [] }),
  context_ref: z.string().optional(),
  policy: z
    .object({
      network: z.enum(["deny", "deny-except-proxies", "allow"]).default("deny-except-proxies"),
      fs_scope: z.literal("worktree").default("worktree"),
      max_turns: z.number().int().positive().default(40),
      wallclock_s: z.number().int().positive().default(900),
    })
    .default({ network: "deny-except-proxies", fs_scope: "worktree", max_turns: 40, wallclock_s: 900 }),
});
export type WorkOrder = z.infer<typeof WorkOrder>;

export const RunnerResult = z.object({
  run_id: z.string().uuid(),
  status: z.enum(["succeeded", "failed", "cancelled"]),
  files_touched: z.array(z.string()).default([]),
  /** Files touched outside touch_set — fed to the engine drift hook. */
  drift: z.array(z.string()).default([]),
  diff_artifact: z.string().nullable().default(null),
  tokens: z.number().int().default(0),
  cost: z.number().default(0),
  summary: z.string().default(""),
});
export type RunnerResult = z.infer<typeof RunnerResult>;

export const RunnerEvent = z.object({
  type: z.enum(["text", "tool_call", "file_edit", "token_usage", "error", "status"]),
  at: z.string(),
  data: z.record(z.any()).default({}),
});
export type RunnerEvent = z.infer<typeof RunnerEvent>;

export interface RunnerIO {
  onEvent(e: RunnerEvent): void;
}

export interface AgentRunner {
  id: string;
  start(order: WorkOrder, io: RunnerIO): Promise<RunnerResult>;
  cancel(runId: string): Promise<void>;
}

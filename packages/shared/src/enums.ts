import { z } from "zod";

/**
 * Canonical enums — mirror plan/01-architecture/data-model.md §1 and the
 * Postgres types in packages/db/migrations/0001_init.sql. Do not diverge.
 */

export const Granularity = z.enum(["g1_micro", "g2_meso", "g3_macro", "g4_mega"]);
export type Granularity = z.infer<typeof Granularity>;

export const ChangeType = z.enum([
  "migration",
  "api_contract",
  "ui_component",
  "logic",
  "refactor",
  "bugfix",
  "config",
  "infra",
  "test",
  "docs",
]);
export type ChangeType = z.infer<typeof ChangeType>;

export const PlanStatus = z.enum([
  "draft",
  "planning",
  "ready",
  "executing",
  "partially_merged",
  "merged",
  "archived",
  "failed",
]);
export type PlanStatus = z.infer<typeof PlanStatus>;

export const NodeStatus = z.enum([
  "pending",
  "ready",
  "running",
  "built",
  "merged",
  "failed",
  "blocked",
  "skipped",
]);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const EdgeType = z.enum(["depends_on", "data_flow", "sequence", "soft_order"]);
export type EdgeType = z.infer<typeof EdgeType>;

export const BranchStatus = z.enum([
  "idle",
  "ready",
  "running",
  "built",
  "merged",
  "conflicted",
  "failed",
]);
export type BranchStatus = z.infer<typeof BranchStatus>;

export const RunKind = z.enum(["plan", "analysis", "node_build", "integration", "replan"]);
export type RunKind = z.infer<typeof RunKind>;

export const RunStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const ShareRole = z.enum(["viewer", "runner", "editor"]);
export type ShareRole = z.infer<typeof ShareRole>;

/** viewer < runner < editor — used for "at least this role" checks. */
export const roleRank: Record<z.infer<typeof ShareRole>, number> = {
  viewer: 1,
  runner: 2,
  editor: 3,
};

export const DelegationStatus = z.enum([
  "draft",
  "sent",
  "accepted",
  "building",
  "returned",
  "merged",
  "declined",
]);
export type DelegationStatus = z.infer<typeof DelegationStatus>;

export const ExecutionBackend = z.enum(["claude_code", "native", "a2a_remote"]);
export type ExecutionBackend = z.infer<typeof ExecutionBackend>;

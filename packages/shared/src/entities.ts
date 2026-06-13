import { z } from "zod";
import {
  Granularity,
  ChangeType,
  PlanStatus,
  NodeStatus,
  EdgeType,
  BranchStatus,
  RunKind,
  RunStatus,
  ShareRole,
  DelegationStatus,
  ExecutionBackend,
} from "./enums.js";
import { LayoutSpec, WidgetSpec } from "./genui.js";

/**
 * Core domain entities — mirror plan/01-architecture/data-model.md.
 * These zod schemas are the cross-service contract (api ↔ workers ↔ web).
 */

const SymbolRef = z.object({
  kind: z.string(),
  name: z.string(),
  file: z.string().optional(),
});

export const TouchSet = z.object({
  predicted: z.object({
    add: z.array(SymbolRef).default([]),
    modify: z.array(SymbolRef).default([]),
    delete: z.array(SymbolRef).default([]),
  }),
  resolved: z
    .object({
      files: z.array(z.string()).default([]),
      symbols: z.array(z.string()).default([]),
      signatures_changed: z.array(z.string()).default([]),
      schema_keys: z.array(z.string()).default([]),
      config_keys: z.array(z.string()).default([]),
    })
    .optional(),
  resolution_confidence: z.number().min(0).max(1).optional(),
});
export type TouchSet = z.infer<typeof TouchSet>;

export const Project = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string(),
  repo_url: z.string(),
  provider: z.enum(["github", "upload"]).default("github"),
  default_branch: z.string().default("main"),
  languages: z.array(z.string()).default([]),
  execution_backend: ExecutionBackend.default("claude_code"),
  created_by: z.string().uuid(),
  created_at: z.string(),
});
export type Project = z.infer<typeof Project>;

export const Plan = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string(),
  prompt: z.string(),
  granularity: Granularity,
  status: PlanStatus,
  base_commit: z.string(),
  current_revision: z.number().int().default(1),
  layout_spec: LayoutSpec.nullable().default(null),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Plan = z.infer<typeof Plan>;

export const PlanNode = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  revision: z.number().int().default(1),
  title: z.string(),
  change_type: ChangeType,
  granularity: Granularity,
  status: NodeStatus,
  summary: z.string(),
  touch_set: TouchSet,
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  branch_id: z.string().uuid().nullable().default(null),
  parent_node_id: z.string().uuid().nullable().default(null),
  worktree_ref: z.string().nullable().default(null),
  diff_artifact_path: z.string().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type PlanNode = z.infer<typeof PlanNode>;

export const EdgeEvidence = z.object({
  reason: z.enum([
    "symbol_dependency",
    "file_overlap",
    "data_flow",
    "signature_change",
    "schema_dependency",
    "sequence",
  ]),
  shared: z.array(z.string()).default([]),
  from_provides: z.array(z.string()).default([]),
  to_consumes: z.array(z.string()).default([]),
  overlap_score: z.number().min(0).max(1).default(0),
});
export type EdgeEvidence = z.infer<typeof EdgeEvidence>;

export const PlanEdge = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  revision: z.number().int().default(1),
  from_node: z.string().uuid(),
  to_node: z.string().uuid(),
  type: EdgeType,
  rationale: z.string().default(""),
  evidence: EdgeEvidence,
  overlap_score: z.number().min(0).max(1).default(0),
});
export type PlanEdge = z.infer<typeof PlanEdge>;

export const Branch = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  label: z.string(),
  node_ids: z.array(z.string().uuid()).default([]),
  status: BranchStatus.default("idle"),
  assignee_user_id: z.string().uuid().nullable().default(null),
  worktree_path: z.string().nullable().default(null),
  independent_of: z.array(z.string().uuid()).default([]),
});
export type Branch = z.infer<typeof Branch>;

// ---- node annotations (P2: the five inspector sections) ----

// `grounded_refs` are REPO symbols/files (P2). `web_sources` are external
// web:linkup URLs (mandated-integrations.md §3.3) — kept structurally distinct so
// external claims never masquerade as verified repo facts.
export const Assumption = z.object({
  text: z.string(),
  grounded_refs: z.array(z.string()).default([]),
  web_sources: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
});
export const AnalysisItem = z.object({
  kind: z.enum(["race_condition", "failure_mode", "edge_case", "perf", "security"]),
  text: z.string(),
  grounded_refs: z.array(z.string()).default([]),
  web_sources: z.array(z.string()).optional(),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  confidence: z.number().min(0).max(1).default(0.5),
});
export const Benefit = z.object({
  text: z.string(),
  grounded_refs: z.array(z.string()).default([]),
  web_sources: z.array(z.string()).optional(),
});
export const NotableSymbol = z.object({
  symbol: z.string(),
  file: z.string(),
  role: z.string(),
  why_notable: z.string(),
});

export const NodeAnnotation = z.object({
  node_id: z.string().uuid(),
  revision: z.number().int().default(1),
  assumptions: z.array(Assumption).default([]),
  analysis: z.array(AnalysisItem).default([]),
  benefits: z.array(Benefit).default([]),
  notable_symbols: z.array(NotableSymbol).default([]),
  widget_specs: z.array(WidgetSpec).default([]),
  model: z.string().optional(),
  generated_at: z.string().optional(),
});
export type NodeAnnotation = z.infer<typeof NodeAnnotation>;

export const Run = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  node_id: z.string().uuid().nullable().default(null),
  branch_id: z.string().uuid().nullable().default(null),
  kind: RunKind,
  status: RunStatus,
  agent: z.string().default(""),
  model: z.string().default(""),
  started_at: z.string().nullable().default(null),
  finished_at: z.string().nullable().default(null),
  tokens: z.number().int().default(0),
  cost: z.number().default(0),
  logs_stream_key: z.string().nullable().default(null),
  result: z.record(z.any()).nullable().default(null),
  error: z.string().nullable().default(null),
});
export type Run = z.infer<typeof Run>;

export const Delegation = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  subtree_root_node: z.string().uuid(),
  spec_path: z.string().nullable().default(null),
  assigned_to_user: z.string().uuid().nullable().default(null),
  assigned_to_email: z.string().email().nullable().default(null),
  role: ShareRole.default("runner"),
  status: DelegationStatus.default("draft"),
  base_commit: z.string(),
  created_by: z.string().uuid(),
  created_at: z.string(),
});
export type Delegation = z.infer<typeof Delegation>;

export const Share = z.object({
  id: z.string().uuid(),
  resource_type: z.enum(["plan", "project"]),
  resource_id: z.string().uuid(),
  principal_user: z.string().uuid().nullable().default(null),
  principal_email: z.string().email().nullable().default(null),
  role: ShareRole,
  created_by: z.string().uuid(),
  created_at: z.string(),
});
export type Share = z.infer<typeof Share>;

/** A plan plus its graph — the canonical payload the canvas renders. */
export const PlanGraph = z.object({
  plan: Plan,
  nodes: z.array(PlanNode),
  edges: z.array(PlanEdge),
  branches: z.array(Branch),
  annotations: z.array(NodeAnnotation).default([]),
});
export type PlanGraph = z.infer<typeof PlanGraph>;

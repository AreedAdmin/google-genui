import { z } from "zod";
import { Granularity } from "./enums.js";

/**
 * Generative-UI contracts — plan/03-generative-ui/granularity-layouts.md +
 * widget-generation.md. The planner emits a LayoutSpec per plan; the analysis
 * agent emits WidgetSpec[] per node. Both are validated against these schemas
 * before the client renders them (never raw model HTML).
 */

export const CanvasKind = z.enum([
  "checklist", // G1 diff-first
  "compact_dag", // G2 sweet spot
  "swimlane_dag", // G3
  "hierarchical_map", // G4
]);
export type CanvasKind = z.infer<typeof CanvasKind>;

export const LayoutSpec = z.object({
  tier: Granularity,
  canvas: CanvasKind,
  direction: z.enum(["LR", "TB"]).default("LR"),
  grouping: z.enum(["by_module", "by_milestone"]).nullable().default(null),
  emphasis: z.array(z.string()).default([]),
  parallelism_ui: z
    .enum(["hidden", "branch_buttons", "dispatch_parallel", "assign_clusters"])
    .default("branch_buttons"),
  delegation_ui: z
    .enum(["share_diff", "per_branch", "per_lane", "assign_clusters"])
    .default("per_branch"),
  semantic_zoom: z.boolean().default(false),
  default_inspector_tab: z
    .enum(["changes", "contract", "assumptions", "analysis"])
    .default("changes"),
});
export type LayoutSpec = z.infer<typeof LayoutSpec>;

/** The MVP widget set (registry keys). Phase-2 widgets listed for forward-compat. */
export const WidgetKind = z.enum([
  "schema_diff",
  "api_contract",
  "component_preview",
  "call_graph_impact",
  // phase 2:
  "key_diff",
  "test_linkage",
  "resource_diagram",
  "markdown",
  "checklist",
  // composable layer: a model-assembled body from primitive blocks
  "composed",
]);
export type WidgetKind = z.infer<typeof WidgetKind>;

export const WidgetSpec = z.object({
  widget: WidgetKind,
  version: z.number().int().positive().default(1),
  /** Validated per-widget at the registry boundary on the client. */
  props: z.record(z.any()),
  /** Symbols/files the props were grounded in (for citation links). */
  grounding: z.array(z.string()).default([]),
  /** Shown if the widget fails to render / is unknown. */
  fallback_text: z.string().optional(),
});
export type WidgetSpec = z.infer<typeof WidgetSpec>;

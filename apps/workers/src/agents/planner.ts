import { z } from "zod";
import {
  Granularity,
  ChangeType,
  LayoutSpec,
  type Granularity as GranularityT,
} from "@trellis/shared";
import { toolForcedJSON, type JsonSchema } from "../anthropic.js";
import { env } from "../env.js";
import { webSearchTool } from "./linkup.js";
import { logger } from "../log.js";

const log = logger("planner");

/**
 * Planner Agent (planner-agent.md). Opus 4.8, tool-forced `emit_plan`. Decomposes
 * prompt + repo summary into Nodes[] (title, change_type, summary, COARSE
 * predicted touch_set) + a plan-level LayoutSpec, with granularity detection
 * (G1..G4). It never derives edges or asserts independence — that is the engine.
 */

// ---- output schema (zod, mirrors emit_plan in planner-agent.md §6) ----

const PredictedSymbolZ = z.object({
  kind: z.string().default("unknown"),
  name: z.string(),
  file: z.string().optional(),
  change_signature: z.boolean().optional(),
});

const PlannerNodeZ = z.object({
  title: z.string(),
  change_type: ChangeType,
  granularity: Granularity,
  summary: z.string(),
  touch_set: z.object({
    predicted: z.object({
      add: z.array(PredictedSymbolZ).default([]),
      modify: z.array(PredictedSymbolZ).default([]),
      delete: z.array(PredictedSymbolZ).default([]),
    }),
  }),
});
export type PlannerNode = z.infer<typeof PlannerNodeZ>;

const CoarseOrderZ = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.literal("soft_order").default("soft_order"),
});

const EmitPlanZ = z.object({
  detected_granularity: Granularity,
  tier_reason: z.string(),
  layout_spec: LayoutSpec,
  nodes: z.array(PlannerNodeZ).min(1),
  coarse_order: z.array(CoarseOrderZ).default([]),
});
export type EmitPlan = z.infer<typeof EmitPlanZ>;

// ---- JSON Schema given to the model (loose; zod is the real gate) ----

const granularityEnum = ["g1_micro", "g2_meso", "g3_macro", "g4_mega"];
const changeTypeEnum = [
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
];

const EMIT_PLAN_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["detected_granularity", "tier_reason", "layout_spec", "nodes"],
  properties: {
    detected_granularity: { type: "string", enum: granularityEnum },
    tier_reason: { type: "string" },
    layout_spec: {
      type: "object",
      additionalProperties: false,
      required: ["tier", "canvas"],
      properties: {
        tier: { type: "string", enum: granularityEnum },
        canvas: { type: "string", enum: ["checklist", "compact_dag", "swimlane_dag", "hierarchical_map"] },
        direction: { type: "string", enum: ["LR", "TB"] },
        grouping: { type: ["string", "null"], enum: ["by_module", "by_milestone", null] },
        emphasis: { type: "array", items: { type: "string" } },
        parallelism_ui: {
          type: "string",
          enum: ["hidden", "branch_buttons", "dispatch_parallel", "assign_clusters"],
        },
        delegation_ui: { type: "string", enum: ["share_diff", "per_branch", "per_lane", "assign_clusters"] },
        semantic_zoom: { type: "boolean" },
        default_inspector_tab: { type: "string", enum: ["changes", "contract", "assumptions", "analysis"] },
      },
    },
    nodes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "change_type", "granularity", "summary", "touch_set"],
        properties: {
          title: { type: "string" },
          change_type: { type: "string", enum: changeTypeEnum },
          granularity: { type: "string", enum: granularityEnum },
          summary: { type: "string" },
          touch_set: {
            type: "object",
            additionalProperties: false,
            required: ["predicted"],
            properties: {
              predicted: {
                type: "object",
                additionalProperties: false,
                required: ["add", "modify", "delete"],
                properties: {
                  add: { type: "array", items: predictedSymbolSchema() },
                  modify: { type: "array", items: predictedSymbolSchema() },
                  delete: { type: "array", items: predictedSymbolSchema() },
                },
              },
            },
          },
        },
      },
    },
    coarse_order: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          kind: { type: "string", enum: ["soft_order"] },
        },
      },
    },
  },
};

function predictedSymbolSchema(): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", "name"],
    properties: {
      kind: { type: "string" },
      name: { type: "string" },
      file: { type: "string" },
      change_signature: { type: "boolean" },
    },
  };
}

// ---- granularity heuristic prior (planner-agent.md §3) ----

/** A cheap request-shape prior the prompt nudges the model toward. */
export function granularityPrior(prompt: string): { tier: GranularityT; reason: string } {
  const p = prompt.toLowerCase();
  const microVerbs = /\b(fix|rename|tighten|tweak|bump|typo|adjust|patch)\b/;
  const megaVerbs = /\b(greenfield|rewrite|migrate everything|new service|from scratch|rearchitect|overhaul)\b/;
  const macroVerbs = /\b(refactor|subsystem|new service|extract|restructure|split)\b/;
  if (megaVerbs.test(p)) return { tier: "g4_mega", reason: "greenfield/large-migration verbs" };
  if (macroVerbs.test(p)) return { tier: "g3_macro", reason: "subsystem/refactor verbs" };
  if (microVerbs.test(p) && p.length < 120) return { tier: "g1_micro", reason: "single-change verbs, short prompt" };
  return { tier: "g2_meso", reason: "default: one feature/flow" };
}

const TIER_BANDS: Record<GranularityT, [number, number]> = {
  g1_micro: [1, 3],
  g2_meso: [4, 15],
  g3_macro: [15, 50],
  g4_mega: [50, 9999],
};

/** Reconcile detected tier against actual node count (planner-agent.md §3.3). */
export function reconcileTier(detected: GranularityT, nodeCount: number): GranularityT {
  const order: GranularityT[] = ["g1_micro", "g2_meso", "g3_macro", "g4_mega"];
  for (const tier of order) {
    const [lo, hi] = TIER_BANDS[tier];
    if (nodeCount >= lo && nodeCount <= hi) return tier;
  }
  return detected;
}

const SYSTEM = `You are Trellis's Planner agent. You decompose a coding request into a dependency-graph plan.

Hard rules (planner-agent.md):
- Your FINAL answer MUST be the emit_plan tool call (no prose). You MAY first call the web_search tool for EXTERNAL knowledge — library deprecations, current APIs, known pitfalls — when it would improve the plan; skip it when the repo summary suffices. web_search results are web:linkup — hints only, NOT repo-verified.
- Predictions are COARSE: {kind, name, file} triples under add/modify/delete. Do NOT enumerate callers, do NOT claim independence, do NOT derive edges — a deterministic engine resolves all of that.
- Decompose to the granularity that produces a MEANINGFUL DAG and no finer. Over-decomposition manufactures fake dependencies; under-decomposition hides parallelism.
- One node per coherent contract/surface (migration, api_contract, ui_component, config, test). For a true one-change request emit a SINGLE node — never invent a DAG.
- Match node titles and predicted file paths to the repo's real conventions when the summary provides them.
- Emit a plan-level LayoutSpec. The tier is a PRIOR from request size (g1 small .. g4 large), but CHOOSE the canvas that best fits the work's ACTUAL shape — you are NOT forced to map tier->canvas 1:1:
    * checklist — a tiny diff-first change only (<=3 nodes); collapses the DAG to a list.
    * compact_dag — a single feature/flow as a left-to-right dependency graph.
    * swimlane_dag — work that splits into parallel lanes by module/area (set grouping=by_module).
    * hierarchical_map — large plans (15+ nodes) that cluster into milestones/super-nodes (set grouping=by_milestone, semantic_zoom=true).
  Also set direction, emphasis, and parallelism_ui to fit the plan (e.g. dispatch_parallel when several independent lanes exist).
- coarse_order entries are SOFT ordering hints only ("scaffold before wiring"); the engine may override them.`;

export interface PlannerInput {
  prompt: string;
  repoSummary: string;
  baseCommit: string;
}

export async function runPlanner(input: PlannerInput): Promise<{ plan: EmitPlan; tokens: number }> {
  const prior = granularityPrior(input.prompt);
  log.info(`granularity prior: ${prior.tier} (${prior.reason})`);

  const userPrompt = `# Request
${input.prompt}

# Repo summary (conventions, modules, framework surfaces)
${input.repoSummary || "(no repo summary available — predict conservatively, mark new symbols in `add`)"}

# Granularity hint
Prior tier from request shape: ${prior.tier} — ${prior.reason}.
Detect the real tier from request shape + touch-set breadth + your node count. If your node count lands outside the tier band, RE-TIER with a visible tier_reason rather than forcing the band.
Tier bands: g1_micro=1-3 nodes, g2_meso=4-15, g3_macro=15-50, g4_mega=50+.

Base commit: ${input.baseCommit || "(unknown)"}

Call emit_plan now.`;

  const { data, tokens, toolCalls } = await toolForcedJSON({
    model: env.plannerModel,
    system: SYSTEM,
    prompt: userPrompt,
    toolName: "emit_plan",
    toolDescription:
      "Emit the decomposed plan: detected_granularity, tier_reason, a plan-level layout_spec, nodes[] with COARSE predicted touch_sets, and optional soft coarse_order hints.",
    inputSchema: EMIT_PLAN_SCHEMA,
    validator: EmitPlanZ,
    maxTokens: 12000,
    agentTools: [webSearchTool],
  });
  log.info(`planner web_search calls: ${toolCalls}`);

  // Reconcile only the TIER LABEL against the real node count (it drives analysis
  // depth + cost budgets). The CANVAS is the model's call — granularity is a prior,
  // not a cage (granularity-layouts.md) — subject only to a coherence guard below.
  const reconciled = reconcileTier(data.detected_granularity, data.nodes.length);
  if (reconciled !== data.detected_granularity) {
    log.info(`re-tiering ${data.detected_granularity} -> ${reconciled} (node count ${data.nodes.length})`);
    data.detected_granularity = reconciled;
    data.layout_spec.tier = reconciled;
  }

  // Keep the model's chosen canvas unless it would render incoherently.
  const guarded = coherentCanvas(data.layout_spec.canvas, data.nodes.length);
  if (guarded.canvas !== data.layout_spec.canvas) {
    log.info(`canvas guard: ${data.layout_spec.canvas} -> ${guarded.canvas} (node count ${data.nodes.length})`);
    data.layout_spec.canvas = guarded.canvas;
  }

  return { plan: data, tokens };
}

/**
 * Coherence guard for the model-chosen canvas. The planner picks the canvas
 * freely (layout is model-driven); we only correct choices that would render
 * incoherently against the actual node count — we never force tier->canvas:
 *   - checklist collapses the DAG, so it's sane only for a handful of nodes;
 *   - hierarchical_map is for large, clusterable plans, so below the macro band
 *     it renders every flat node as an oversized super-node.
 * compact_dag and swimlane_dag are coherent at any reasonable count and pass through.
 */
function coherentCanvas(
  requested: LayoutSpec["canvas"],
  nodeCount: number,
): { canvas: LayoutSpec["canvas"] } {
  if (requested === "checklist" && nodeCount > TIER_BANDS.g1_micro[1]) {
    return { canvas: "compact_dag" };
  }
  if (requested === "hierarchical_map" && nodeCount < TIER_BANDS.g3_macro[0]) {
    return { canvas: "swimlane_dag" };
  }
  return { canvas: requested };
}

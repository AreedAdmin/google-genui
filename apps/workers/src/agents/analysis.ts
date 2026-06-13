import { z } from "zod";
import { NodeAnnotation, type TouchSet, type ChangeType, type WidgetKind } from "@trellis/shared";
import { toolForcedJSON, type JsonSchema } from "../anthropic.js";
import { analysisService } from "../analysis.js";
import { env } from "../env.js";
import { logger } from "../log.js";

const log = logger("analysis-agent");

/**
 * Analysis / Annotation Agent (analysis-annotation-agent.md). Opus 4.8, tool-forced
 * `emit_annotations`. Per node it produces the five inspector sections
 * (assumptions / analysis(risks) / benefits / notable_symbols) + a per-node
 * WidgetSpec[] keyed by change_type. Discipline: GROUND EVERY CLAIM with
 * grounded_refs from the resolved touch-set / blast radius, or wear a low-confidence
 * label. We additionally enforce ground-or-flag in TS: refs that don't appear in
 * the node's resolved symbol/file set get demoted to confidence < 0.5.
 */

// emit_annotations output (subset of NodeAnnotation the agent authors).
const EmitAnnotationsZ = NodeAnnotation.pick({
  assumptions: true,
  analysis: true,
  benefits: true,
  notable_symbols: true,
  widget_specs: true,
});
export type EmitAnnotations = z.infer<typeof EmitAnnotationsZ>;

const widgetKindEnum: WidgetKind[] = [
  "schema_diff",
  "api_contract",
  "component_preview",
  "call_graph_impact",
  "key_diff",
  "test_linkage",
  "resource_diagram",
  "markdown",
  "checklist",
];

const EMIT_ANNOTATIONS_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assumptions", "analysis", "benefits", "notable_symbols", "widget_specs"],
  properties: {
    assumptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "grounded_refs", "confidence"],
        properties: {
          text: { type: "string" },
          grounded_refs: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    analysis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text", "grounded_refs", "severity", "confidence"],
        properties: {
          kind: { type: "string", enum: ["race_condition", "failure_mode", "edge_case", "perf", "security"] },
          text: { type: "string" },
          grounded_refs: { type: "array", items: { type: "string" } },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    benefits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "grounded_refs"],
        properties: {
          text: { type: "string" },
          grounded_refs: { type: "array", items: { type: "string" } },
        },
      },
    },
    notable_symbols: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["symbol", "file", "role", "why_notable"],
        properties: {
          symbol: { type: "string" },
          file: { type: "string" },
          role: { type: "string" },
          why_notable: { type: "string" },
        },
      },
    },
    widget_specs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["widget", "props", "grounding"],
        properties: {
          widget: { type: "string", enum: widgetKindEnum },
          version: { type: "integer", minimum: 1 },
          props: { type: "object" },
          grounding: { type: "array", items: { type: "string" } },
          fallback_text: { type: "string" },
        },
      },
    },
  },
};

/** change_type -> expected primary widget (analysis-annotation-agent.md §6). */
const WIDGET_FOR_CHANGE_TYPE: Record<ChangeType, WidgetKind> = {
  migration: "schema_diff",
  api_contract: "api_contract",
  ui_component: "component_preview",
  logic: "call_graph_impact",
  refactor: "call_graph_impact",
  bugfix: "test_linkage",
  config: "key_diff",
  infra: "resource_diagram",
  test: "checklist",
  docs: "markdown",
};

const SYSTEM = `You are Trellis's Analysis/Annotation agent. For ONE plan node you produce the five inspector sections and the node's widget specs.

Hard rules (analysis-annotation-agent.md):
- Output ONLY via emit_annotations. No prose outside tool fields.
- GROUND EVERY CLAIM. Each assumption / analysis(risk) / benefit must carry >=1 grounded_refs pointing at a real symbol ("file#symbol") or file that appears in this node's resolved touch-set or blast radius. A claim you cannot tie to a real ref MUST be emitted with confidence < 0.5 (it will render as low-confidence).
- "analysis" is the RISK register: each entry needs a kind in {race_condition, failure_mode, edge_case, perf, security}, a severity in {low, medium, high}, and >=1 grounded_refs.
- notable_symbols are the real symbols a reviewer must know (role: provider | consumer | mutated).
- Do NOT restate the diff as a benefit. Do NOT fabricate symbols that aren't in the touch-set.
- Emit at least one WidgetSpec, keyed by the node's change_type, with grounded props (never raw HTML).`;

export interface AnalysisInput {
  projectId: string;
  commit: string;
  nodeId: string;
  title: string;
  summary: string;
  changeType: ChangeType;
  touchSet: TouchSet;
}

export async function runAnalysis(input: AnalysisInput): Promise<{ annotation: EmitAnnotations; tokens: number }> {
  // Grounding fetch: pull blast radius for the first resolved symbol (best-effort).
  const resolved = input.touchSet.resolved;
  const groundingRefs = new Set<string>([...(resolved?.symbols ?? []), ...(resolved?.files ?? [])]);

  let blastSummary = "";
  const firstSym = resolved?.symbols?.[0];
  if (firstSym) {
    const impact = await analysisService.callgraphImpact(input.projectId, input.commit, firstSym, "signature");
    if (impact) {
      impact.affected_symbols.forEach((s) => groundingRefs.add(s));
      impact.affected_files.forEach((f) => groundingRefs.add(f));
      blastSummary = `Callgraph impact of ${firstSym}: ${impact.affected_symbols.slice(0, 8).join(", ")}`;
    }
  }

  const expectedWidget = WIDGET_FOR_CHANGE_TYPE[input.changeType];

  const userPrompt = `# Node
Title: ${input.title}
change_type: ${input.changeType}
Summary: ${input.summary}

# Resolved touch-set (cite from here)
files: ${JSON.stringify(resolved?.files ?? [])}
symbols: ${JSON.stringify(resolved?.symbols ?? [])}
signatures_changed: ${JSON.stringify(resolved?.signatures_changed ?? [])}
schema_keys: ${JSON.stringify(resolved?.schema_keys ?? [])}
config_keys: ${JSON.stringify(resolved?.config_keys ?? [])}
resolution_confidence: ${input.touchSet.resolution_confidence ?? "unknown"}
${blastSummary ? `\n# Blast radius\n${blastSummary}` : ""}

Write the five sections grounded in the refs above. Then emit at least one widget_spec; the primary widget for a "${input.changeType}" node is "${expectedWidget}". Call emit_annotations now.`;

  const { data, tokens } = await toolForcedJSON({
    model: env.analysisModel,
    system: SYSTEM,
    prompt: userPrompt,
    toolName: "emit_annotations",
    toolDescription:
      "Emit the node's five inspector sections (assumptions, analysis(risks), benefits, notable_symbols) and grounded widget_specs.",
    inputSchema: EMIT_ANNOTATIONS_SCHEMA,
    validator: EmitAnnotationsZ,
    maxTokens: 10000,
  });

  // Ground-or-flag enforcement: demote claims whose refs don't resolve.
  const refResolves = (refs: string[]) =>
    refs.length > 0 && refs.some((r) => groundingRefs.has(r) || groundingRefs.has(r.split("#")[0] ?? r));

  for (const a of data.assumptions) {
    if (!refResolves(a.grounded_refs) && a.confidence >= 0.5) a.confidence = 0.4;
  }
  for (const a of data.analysis) {
    // Never silence a grounded high-severity risk; only demote ungrounded ones.
    if (!refResolves(a.grounded_refs) && a.confidence >= 0.5) a.confidence = 0.4;
  }

  // Guarantee at least one widget for the change_type so the inspector always renders.
  if (data.widget_specs.length === 0) {
    data.widget_specs.push({
      widget: expectedWidget,
      version: 1,
      props: { title: input.title, summary: input.summary },
      grounding: [...groundingRefs].slice(0, 8),
      fallback_text: `Changes for ${input.title}`,
    });
  }

  log.info(`node ${input.nodeId}: ${data.assumptions.length} assumptions, ${data.analysis.length} risks, ${data.widget_specs.length} widgets`);
  return { annotation: data, tokens };
}

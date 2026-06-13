# Planner Agent (P1)

> Status: **Canonical.** The Planner decomposes `prompt + repo summary + detected granularity` into `Nodes[]` with coarse **predicted `touch_set`**s and a plan-level `LayoutSpec` — deliberately *proposing structure for the [engine](./dependency-inference-engine.md) to resolve*, never inventing dependencies itself.

## 1. Role in the pipeline

The Planner is **Stage 2** of the [dependency engine pipeline](./dependency-inference-engine.md#3-pipeline-7-stages) and the first LLM in the [agent topology](./overview.md#3-pipeline-diagram). It runs on **Opus 4.8** (deep decomposition + granularity judgment) on `queue:plan-build`, with the [cached repo-context block](./prompts-and-tools.md#5-prompt-caching-strategy).

**Hard boundary:** the Planner outputs *Nodes and coarse touch-set predictions*. It does **not** decide independence, derive Edges, or enumerate callers — that is the deterministic [engine](./dependency-inference-engine.md#5-why-grounding-not-pure-llm-is-the-design)'s job. The Planner's job is good *decomposition* and honest *prediction*.

## 2. Input → Output

**Input** (one tool-forced context object):
- `prompt` — the user's intent (`plans.prompt`).
- `repo_summary` — symbol/module summaries, conventions, framework surfaces from the [analysis service](./dependency-inference-engine.md#stage-1--repo-index-python-analysis-service) (the cached block).
- `granularity_hint` — auto-detected tier (§3), and any user override.
- `base_commit` — the commit the plan is planned against.

**Output** (tool-forced JSON, §6):
- `Nodes[]` — each with `title`, `change_type` (the [enum](../01-architecture/data-model.md#1-enums)), `summary`, `granularity` (may be finer than the plan), and a **predicted** `touch_set` per [data-model §5](../01-architecture/data-model.md#5-key-json-shapes).
- `LayoutSpec` — the plan-level canvas spec ([granularity-layouts §3](../03-generative-ui/granularity-layouts.md#3-granularity-layout-spec-machine-form)).
- `coarse_order[]` — optional `soft_order` hints the planner asserts (e.g. "scaffold before wiring"); the engine treats these as *soft* edges, never hard.
- `detected_granularity` + a one-line `tier_reason`.

The predicted `touch_set.predicted` is intentionally **coarse** — `{kind, name, file}` triples under `add/modify/delete`. The engine's [Stage 3](./dependency-inference-engine.md#stage-3--resolve-touch-sets-to-real-symbols) resolves these to real symbols and computes the blast radius; unresolved predictions lower confidence and force `soft_order` rather than a false hard claim.

## 3. Granularity detection (G1–G4)

Tier = `f(request shape, touch-set breadth, node count)`, defaulted then **user-overridable** (override re-emits the `LayoutSpec` and re-flows the canvas — [granularity-layouts §3](../03-generative-ui/granularity-layouts.md#3-granularity-layout-spec-machine-form)).

| Signal | G1 Micro | G2 Meso | G3 Macro | G4 Mega |
|--------|----------|---------|----------|---------|
| **Request shape** | single symbol/file; verbs *fix/rename/tighten* | one feature/route/flow | subsystem refactor / new service | greenfield / large migration |
| **Touch-set breadth** | 1 file, ≤2 symbols | a handful of files | cross-module | repo-wide / new tree |
| **Node count** | 1–3 | 4–15 | 15–50 | 50+ |
| **`LayoutSpec.canvas`** | `checklist` | `compact_dag` | `swimlane_dag` | `hierarchical_map` |

**Detection procedure:**
1. Classify request shape from the prompt (verb + object scope) → a *prior* tier.
2. Probe touch-set breadth: a cheap pass over `repo_summary` estimates how many modules the intent touches → adjusts the prior.
3. After decomposition, reconcile against actual node count; if it lands outside the tier's band, **re-tier with a visible `tier_reason`** (per [deliverables D3-AC2](../00-overview/deliverables.md#d3--planner-agent-p1)) rather than silently forcing the band.
4. Honor any explicit user override (`granularity_hint.override`) and log the correction to improve detection ([granularity-layouts §7](../03-generative-ui/granularity-layouts.md#7-edge-cases)).

## 4. Decomposition strategy per tier

The cardinal rule: **decompose to the granularity that produces a *meaningful* DAG, and no finer.** Over-decomposition manufactures fake dependencies; under-decomposition hides parallelism.

| Tier | Strategy | Anti-pattern to avoid |
|------|----------|-----------------------|
| **G1** | Emit 1–3 Nodes; for a true one-change request, **a single Node**. Do not invent a DAG. | Splitting one validation tweak into "edit / test / lint" ceremony. |
| **G2** | One Node per coherent contract or surface (migration, api_contract, ui_component, config, test). 4–15. This is the sweet spot. | Per-file or per-function nodes that the engine would just re-merge. |
| **G3** | Decompose by **module/component** (maps to swimlanes); name **Integration** reconvergence points explicitly; keep each node a reviewable unit. | A flat 40-node list with no module grouping. |
| **G4** | Decompose into **super-nodes** (one per subsystem/milestone, `parent_node_id` set), each expandable into a G3/G2 sub-DAG on demand. Plan *who-does-what*, not diffs. | A literal 200-node graph rendered at once (un-navigable). |

For G4, the planner emits **cluster boundaries first**; sub-DAGs are decomposed lazily when a super-node is expanded (mirrors the engine's [G4 large-graph mitigation](./dependency-inference-engine.md#9-failure-modes--mitigations)).

## 5. How it avoids inventing structure

This is the Planner's central discipline, and it is what keeps the [engine's honesty guarantees](./dependency-inference-engine.md#4-the-honesty-guarantees-non-negotiable) intact:

1. **Predictions are coarse and clearly marked `predicted`.** The planner says "modify `login`"; it does **not** claim which callers break — that is `callgraph-impact`'s job.
2. **No independence claims.** The planner never labels two nodes parallel; it may emit `soft_order` hints, which the engine is free to override with hard evidence.
3. **New vs existing is flagged, not assumed.** A symbol the planner expects to create goes in `add`; if it actually exists, the engine's resolution will catch it (fuzzy-match), and confidence adjusts.
4. **Coarse touch-sets are a feature.** The engine *wants* honest under-specification it can resolve, not a confident hallucinated blast radius it must trust.

## 6. Tool-forced output schema

The Planner output is produced via a **forced tool call** (`emit_plan`), validated by zod (TS) ↔ shared JSON Schema ↔ pydantic — see [prompts-and-tools.md §4](./prompts-and-tools.md#4-output-schema-enforcement).

```jsonc
// emit_plan tool input  (schema-validated; no prose)
{
  "detected_granularity": "g2_meso",
  "tier_reason": "single feature, ~5 files across db/api/web",
  "layout_spec": {                      // → granularity-layouts §3
    "tier": "g2_meso", "canvas": "compact_dag", "direction": "LR",
    "grouping": null, "emphasis": ["contracts","tests"],
    "parallelism_ui": "branch_buttons", "delegation_ui": "per_branch",
    "semantic_zoom": false, "default_inspector_tab": "contract"
  },
  "nodes": [
    {
      "title": "Add oauth_accounts table",
      "change_type": "migration",
      "granularity": "g2_meso",
      "summary": "New table linking users to external OAuth identities.",
      "touch_set": {                    // → data-model §5 (predicted only)
        "predicted": {
          "add":    [{ "kind": "table", "name": "oauth_accounts", "file": "db/migrations/" }],
          "modify": [],
          "delete": []
        }
      }
    }
    // …more nodes
  ],
  "coarse_order": [
    { "from": "Add oauth_accounts table", "to": "Add /auth/oauth route", "kind": "soft_order" }
  ]
}
```

The engine fills `touch_set.resolved` and `resolution_confidence`; the planner never writes those fields.

## 7. Prompt design notes

Full skeleton in [prompts-and-tools.md §7 (planner)](./prompts-and-tools.md#7-per-agent-prompt-skeletons). Key points:

- **Context provided:** the [cached repo-context block](./prompts-and-tools.md#5-prompt-caching-strategy) (symbol summaries, **conventions** — file layout, naming, test framework, migration tooling — and framework surfaces), the prompt, the granularity hint. Cached per `{project, commit}`.
- **Conventions extraction:** the planner reads conventions so node `title`s and predicted file paths match the repo's real layout (e.g. `db/migrations/` vs `prisma/`), which materially improves the engine's resolution hit-rate.
- **Few-shot examples:** one worked decomposition per tier (G1/G2/G3/G4) showing the *right* node count and the *coarse* touch-set style — anchoring the model away from over-decomposition.
- **Tools available:** read-only — `symbol-graph`, `resolve-touchset` (for a cheap sanity probe), `file read`. The planner may *peek* to ground a path but must not over-invest; resolution is the engine's stage.

## 8. Failure handling

| Failure | Handling |
|---------|----------|
| **Empty plan** (no changes needed) | Emit a single G1 node of `change_type: docs`/`logic` carrying a "no changes needed — here's why" rationale; canvas renders the empty-plan panel ([granularity-layouts §7](../03-generative-ui/granularity-layouts.md#7-edge-cases)). Never fabricate work. |
| **Over-large plan** (exceeds tier band) | Re-tier upward with `tier_reason`; at G4, auto-cluster into super-nodes under a node cap rather than emitting a flat wall. |
| **Invalid/under-specified output** | Bounded repair: re-prompt with the zod error, ≤2 retries; then mark the `plan` run `failed` with a captured reason ([overview §7](./overview.md#7-shared-concerns-cut-across-every-agent)). |
| **Granularity mis-detected** | One-click user override re-emits `LayoutSpec`; correction logged. |
| **Prompt too vague to decompose** | Emit a minimal plan + a `needs_context` flag surfacing a clarifying question in the iteration panel, instead of guessing structure. |

## 9. Quality bar & eval hooks

Tied to [deliverable D3](../00-overview/deliverables.md#d3--planner-agent-p1) and the [eval harness](../05-implementation/testing-and-eval.md):

- **Decomposition quality:** node count within tier band on the golden set; no manufactured nodes (a node whose resolved touch-set is empty is a smell).
- **Granularity accuracy:** detected tier matches the labeled tier on the golden repos; override rate tracked as a real-world signal.
- **Touch-set precision proxy:** fraction of predicted symbols that the engine successfully resolves to real graph nodes (high = honest, well-grounded predictions).
- **Schema validity:** ≥99% of outputs pass zod on first try; repair-loop rate is a model-health metric.
- **Latency:** Planner step within the < ~30s G2 first-plan budget.

## To-do list

- [ ] Granularity detector (request shape + touch-set breadth probe + node-count reconciliation) with override + correction logging.
- [ ] `emit_plan` tool schema (zod ↔ JSON Schema ↔ pydantic) with the `LayoutSpec` and predicted-only `touch_set`.
- [ ] Per-tier decomposition prompting (few-shot examples G1–G4) tuned against over-decomposition.
- [ ] Conventions-extraction pass feeding node titles + predicted file paths.
- [ ] G4 super-node clustering with lazy sub-DAG decomposition under a node cap.
- [ ] Empty-plan and over-large-plan handling paths.
- [ ] `needs_context` flag → clarifying-question surface in the iteration panel.
- [ ] Bounded repair loop on schema-invalid output (≤2 retries).
- [ ] Eval hooks: node-count-in-band, granularity accuracy, predicted-symbol resolution rate, schema-validity, latency.
- [ ] Golden-set planner fixtures (one labeled plan per tier).

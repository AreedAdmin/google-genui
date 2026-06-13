# Analysis / Annotation Agent (P2)

> Status: **Canonical.** Per Node, this agent produces the **five inspector sections** (Assumptions, Analysis/risks, Benefits, Notable variables & objects) and the per-node `WidgetSpec[]` — under one non-negotiable rule: **every claim cites a real symbol/file (`grounded_refs`) from the [analysis service](./dependency-inference-engine.md#7-data-contracts-analysis-service-api), or is labeled low-confidence.** Hallucination is the enemy of trust.

## 1. Role & guiding theme

Runs on **Opus 4.8** (trust-critical) on `queue:analysis`, **after** the [engine](./dependency-inference-engine.md) has built the DAG. It fans out per Node, runs **async**, and **streams into the [node inspector](../03-generative-ui/node-inspector.md)** as each section completes — the graph is usable before annotation finishes ([overview §3](./overview.md#3-pipeline-diagram)).

> **The theme is grounding.** The Planner proposes and the engine decides *structure*; this agent explains *meaning* — and an explanation the user can't verify is worse than none, because it erodes trust in the whole plan. So the architecture forces every claim to either **point at real code** (`grounded_refs`) or **wear a low-confidence label**. There is no third state.

This implements [deliverable D5](../00-overview/deliverables.md#d5--grounded-analysis--annotation-p2) and pillar **P2**.

## 2. Output — the five sections + widgets

Persisted to `node_annotations` (1:1 with a node, per revision — [data-model](../01-architecture/data-model.md#2-core-tables)). The shape is authoritative there; reproduced with grounding semantics:

```jsonc
// node_annotations  (per node, per revision)
{
  "node_id": "…", "revision": 3,

  "assumptions": [
    { "text": "login() returns a Promise<Session>",
      "grounded_refs": ["src/auth/index.ts#login"],   // ← cite or be low-confidence
      "confidence": 0.91 }
  ],

  "analysis": [                                        // the risk section
    { "kind": "race_condition",                        // race_condition|failure_mode|edge_case|perf|security
      "text": "Concurrent logins may double-insert oauth_accounts.",
      "grounded_refs": ["db/migrations/004_oauth.sql", "src/auth/oauth.ts#upsertAccount"],
      "severity": "high",                              // low|med|high
      "confidence": 0.78 }
  ],

  "benefits": [
    { "text": "Removes the bespoke session cookie path.",
      "grounded_refs": ["src/auth/cookie.ts"] }
  ],

  "notable_symbols": [
    { "symbol": "createSession", "file": "src/auth/session.ts",
      "role": "provider", "why_notable": "new symbol every consumer node depends on" }
  ],

  "widget_specs": [ /* → §6, keyed by change_type, validated */ ],

  "model": "claude-opus-4-8", "tokens": 0, "cost": 0, "generated_at": "…"
}
```

The **Analysis** array is the risk register: each entry is one risk with a `kind` from the [enum](../01-architecture/data-model.md#2-core-tables) (`race_condition | failure_mode | edge_case | perf | security`), a `severity`, and `grounded_refs`. **Notable variables & objects** = the `notable_symbols` array — the real symbols a reviewer must know about, each with a `role` (provider/consumer/mutated) and `why_notable`.

## 3. Grounding procedure (the core mechanism)

For each Node, before writing any claim, the agent **fetches its evidence** so it can cite, not guess:

1. **Pull the blast radius from the engine.** The node already carries `touch_set.resolved` + `resolution_confidence`. Call [`callgraph-impact`](./dependency-inference-engine.md#7-data-contracts-analysis-service-api) and read the node's `Edge.evidence` to obtain the real callers, signature targets, type refs, and conflicting symbols.
2. **Read the cited code.** Use the `file read` and `symbol-graph` [tools](./prompts-and-tools.md#2-tool-catalog) to load the actual definitions of the symbols in scope. A claim about `login()`'s return type must be backed by reading `login()`.
3. **Write claims with refs.** Each Assumption/Analysis/Benefit entry must carry ≥1 `grounded_refs` pointing at a symbol (`file#symbol`) or file that actually appears in the symbol graph.
4. **Ground-or-flag.** A claim the agent cannot tie to a real ref **must** be emitted with `confidence < threshold` and rendered as *low-confidence* in the UI — never as a confident statement. A ref that doesn't resolve in the symbol graph is rejected by validation ([prompts-and-tools §6](./prompts-and-tools.md#6-guardrails)).
5. **Inherit structural caution.** Risks about parallel conflict reuse the engine's [false-independence flags](./dependency-inference-engine.md#stage-5--classify-independence--conflict-this-is-the-safety-core) directly (cite the conflicting path) rather than re-deriving them.

This mirrors the system-wide split: the symbol graph supplies *what is real*; Opus supplies *what it means and why it matters*.

## 4. Async streaming into the inspector

- Each node's annotation is an independent `queue:analysis` job; the agent emits sections **incrementally** (Assumptions → Analysis → Benefits → Notable → widgets), writing partials so the [inspector](../03-generative-ui/node-inspector.md) can render a section the moment it lands.
- Streaming uses the same `stream:run:{id}` → client path; durable section content lands in `node_annotations` via Supabase Realtime.
- Annotation is **best-effort and re-runnable**: it never blocks plan readiness or execution. A failed annotation leaves the node operable with an "analysis unavailable — retry" affordance.

## 5. The trust loop (feedback → suppression)

Grounding bounds *correctness*; the trust loop bounds *noise* ([data-model: feedback](../01-architecture/data-model.md#2-core-tables), [D5-AC3](../00-overview/deliverables.md#d5--grounded-analysis--annotation-p2)):

1. Any claim carries thumbs-up/down in the inspector → a `feedback` row (`node_id`, `annotation_path` pointing at the exact claim, `vote`, optional `reason`).
2. **Down-votes feed pattern suppression.** Recurrently down-voted *shapes* of claim (e.g. a boilerplate "consider adding tests" with no grounding, or a low-value `perf` flag on trivial nodes) are mined into suppression rules injected into the prompt as **negative guidance** — "users find claims like X unhelpful; omit unless grounded and high-severity."
3. Up-votes reinforce kept patterns. The loop tunes *signal-to-noise*, never silences a **grounded high-severity** risk (a security/race risk is never suppressed by votes).
4. Suppression is per-project where possible (repo-specific noise) with a global floor.

## 6. Per-node WidgetSpec[]

The agent emits the node's `WidgetSpec[]`, **keyed by `change_type`**, populated with **grounded** data — the second axis of the generative UI ([granularity-layouts §4–5](../03-generative-ui/granularity-layouts.md#4-change-type--node-widget-mapping-the-second-axis)). Widget-spec generation may delegate to **Sonnet 4.6** ([tech-stack §6](../01-architecture/tech-stack.md#6-claude-reasoning)); grounded data comes from the same blast-radius fetch (§3).

| `change_type` | Widget | Grounded from |
|---------------|--------|---------------|
| `migration` | `schema_diff` | resolved schema keys + migration ordering edges |
| `api_contract` | `api_contract` | route + request/response symbols, breaking-change from `signature_change` edges |
| `ui_component` | `component_preview` | component symbol + prop types |
| `logic`/`refactor` | `call_graph_impact` | `callgraph-impact` affected symbols/files |
| `bugfix` | `test_linkage` | failing test + fix symbols |
| `config` | `key_diff` | resolved config keys + consumers |
| `infra` | `resource_diagram` | resources from framework-surface detection |
| `test`/`docs` | `checklist`/`markdown` | lightweight |

Every `WidgetSpec` is validated against the **component registry** (zod); unknown widget or invalid props → safe fallback, never raw HTML ([granularity-layouts §5](../03-generative-ui/granularity-layouts.md#5-how-layouts-are-generated-the-genui-mechanism)).

## 7. Prompt design notes

Full skeleton in [prompts-and-tools.md §7 (analysis)](./prompts-and-tools.md#7-per-agent-prompt-skeletons). Key points:

- **Context:** cached repo-context block + this node's `touch_set.resolved`, its `Edge.evidence`, blast radius, and any false-independence flags. The agent gets *structure as input* and explains it.
- **Forced output:** `emit_annotations` tool call producing the `node_annotations` shape; bounded repair on schema/ref-validation failure.
- **Negative guidance:** suppression rules from the trust loop (§5) injected per project.
- **Discipline reminders:** "cite or flag"; "do not restate the diff as a benefit"; "every Analysis entry needs a real `severity` and ≥1 ref."

## 8. Evaluation

Per [testing-and-eval](../05-implementation/testing-and-eval.md) and [D5-AC2](../00-overview/deliverables.md#d5--grounded-analysis--annotation-p2):

- **Grounding rate:** fraction of claims with ≥1 valid `grounded_refs` resolving in the symbol graph. **Target high.**
- **Hallucination rate:** fraction of claims whose refs *don't* resolve, or whose asserted fact contradicts the cited code (sampled/judged). **Primary trust metric — below threshold.**
- **Usefulness:** thumbs-up rate per section type; down-vote-driven suppression effectiveness over time.
- **Risk recall on adversarial nodes:** the golden set seeds known race/security/edge-case risks; measure how many the agent surfaces (grounded).
- **Latency/cost:** per-node annotation budget; async so it doesn't gate first-plan render.

## To-do list

- [ ] `emit_annotations` tool schema (zod ↔ JSON Schema ↔ pydantic) for the five sections + `grounded_refs` + `widget_specs`.
- [ ] Grounding procedure: fetch blast radius (`callgraph-impact` + `Edge.evidence`), read cited symbols, attach refs.
- [ ] Ground-or-flag enforcement: ref-resolution validation against the symbol graph; reject/flag unresolved refs.
- [ ] Per-section async streaming into the inspector (partial writes + Realtime).
- [ ] Per-node `WidgetSpec[]` generation keyed by `change_type`, validated against the component registry.
- [ ] Feedback capture (`feedback` rows with `annotation_path`) + thumbs UI hooks.
- [ ] Suppression-rule miner from down-votes → per-project negative guidance; protect grounded high-severity risks.
- [ ] Best-effort/re-runnable semantics (never block readiness or execution).
- [ ] Eval: grounding rate, hallucination rate, usefulness (thumbs), risk recall, latency/cost.
- [ ] Golden-set annotation fixtures with seeded adversarial risks.

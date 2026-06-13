# Agent System — Overview & Topology

> Status: **Canonical.** The map a new engineer reads first: every agent, what it consumes/produces, where it runs, which Claude model it uses, and how it hands off to the next stage — with the [dependency engine](./dependency-inference-engine.md) as the gravitational center.

## 1. What the agent system is for

Trellis turns *intent + repo* into an **operable plan**: a dependency graph of grounded change-Nodes the user can inspect, ratify, dispatch in parallel, and delegate. No single agent does this. It is a **pipeline of small, schema-locked agents** — each with one job, a typed input contract, and a typed output contract — wrapped around two deterministic cores (the Python [analysis service](./dependency-inference-engine.md#7-data-contracts-analysis-service-api) and the Node [dependency engine](./dependency-inference-engine.md)).

The guiding split, repeated everywhere in this system:

> **LLMs *propose and explain*; deterministic services *enumerate and decide*.** The Planner proposes Nodes and coarse touch-sets; the analysis service resolves them to real symbols; the engine computes overlaps and independence; the Analysis agent explains the result, grounded in cited symbols. The model never has the last word on a dependency.

## 2. The agents (glossary of responsibilities)

| Agent | Job (one sentence) | Pillar | Detail |
|-------|--------------------|--------|--------|
| **Planner** | Decompose `prompt + repo summary` into `Nodes[]` with `change_type`, `summary`, **predicted `touch_set`**, plus the plan-level `LayoutSpec`. | P1 | [planner-agent.md](./planner-agent.md) |
| **Dependency-Inference Engine** | *(deterministic, not an LLM)* Resolve touch-sets, derive `Edges[]`, classify independence, partition `Branches[]`, flag false-independence. | P1 | [dependency-inference-engine.md](./dependency-inference-engine.md) |
| **Analysis / Annotation** | Per Node, produce the **five sections** (Assumptions, Analysis/risks, Benefits, Notable variables) + per-node `WidgetSpec[]`, every claim grounded in `grounded_refs`. | P2 | [analysis-annotation-agent.md](./analysis-annotation-agent.md) |
| **Builder** | Execute one Node on an isolated git worktree; emit a diff, tests, tokens, cost. | P3 | [builder-agent.md](./builder-agent.md) |
| **Integration** | Merge reconverging Branches at an `integration_node`, run the test gate, surface conflicts. | P3 | [integration-merge.md](./integration-merge.md) |
| **Replan / Drift** | Re-derive the plan on new context or build-time drift; write a new `plan_revisions` row. | P1 | [replan-and-drift.md](./replan-and-drift.md) |

The **analysis service** and the **engine** are not agents (no model, no prompt) but are first-class pipeline stages; agents call the service as a [tool](./prompts-and-tools.md#2-tool-catalog).

## 3. Pipeline diagram

```
 user intent + repo
        │
        ▼
┌───────────────┐   index (cached)   ┌──────────────────────────┐
│  ANALYSIS     │◀──────────────────▶│  PLANNER  (Opus 4.8)      │
│  SERVICE      │   resolve-touchset │  prompt + repo summary    │
│  (Python/     │◀──────────────────▶│   → Nodes[] (+predicted   │
│   FastAPI)    │   overlap          │     touch_set) + LayoutSpec│
│  symbol/call/ │   callgraph-impact └───────────┬──────────────┘
│  type graphs  │                                │ Nodes[]
└──────┬────────┘                                ▼
       │ resolved touch-sets  ┌──────────────────────────────────┐
       └─────────────────────▶│  DEPENDENCY-INFERENCE ENGINE      │
                              │  (Node worker · deterministic)     │
                              │  Edges[] · Branches[] · overlap     │
                              │  false-independence flags           │
                              └───────┬───────────────────┬────────┘
                                      │ plan persisted     │ per-node context
                                      │ (Supabase)         │ (blast radius)
                       ┌──────────────▼──────┐    ┌─────────▼─────────────────┐
                       │  CANVAS / INSPECTOR  │    │ ANALYSIS/ANNOTATION (Opus)│
                       │  ratify · iterate    │◀───│ 5 sections + WidgetSpec[] │
                       │  (Next.js + Realtime)│ async streams into inspector  │
                       └──────────┬───────────┘    └───────────────────────────┘
                                  │ Run node/branch/selection
                                  ▼
                       ┌──────────────────────┐   join   ┌──────────────────┐
                       │  BUILDER (Sonnet 4.6) │─────────▶│ INTEGRATION       │
                       │  worktree · diff      │  drift   │ merge + test gate │
                       └──────────┬───────────┘──┐        └──────────────────┘
                                  │ actual diff   │ touches outside touch_set
                                  ▼               ▼
                          stream:run:{id}   ┌─────────────────────┐
                          (Redis → client)  │ REPLAN/DRIFT (Opus/  │
                                            │ Sonnet) → new revision│
                                            └─────────────────────┘
```

**Read it as two halves.** The **top half** (Planner → Engine) runs synchronously on the `plan-build` queue and must render a first plan in < ~30s (G2). The **bottom half** (Analysis async; Builder/Integration on demand; Replan on drift) runs after the graph exists, streaming into a live canvas.

## 4. Agent contracts (typed, schema-validated)

Every hand-off is a **named JSON contract** validated at *both* ends — `zod` in Node/TS, `pydantic` in Python, sharing one JSON Schema per entity (see [prompts-and-tools.md §4](./prompts-and-tools.md#4-output-schema-enforcement)). Names are authoritative per [data-model.md](../01-architecture/data-model.md).

| Producer → Consumer | Contract | Shape (authoritative def) |
|---------------------|----------|---------------------------|
| Planner → Engine | `Node[]` with `predicted` touch_set + plan `LayoutSpec` | [data-model §5](../01-architecture/data-model.md#5-key-json-shapes), [LayoutSpec](../03-generative-ui/granularity-layouts.md#3-granularity-layout-spec-machine-form) |
| Engine ↔ Analysis service | `resolve-touchset` / `overlap` / `callgraph-impact` | [engine §7](./dependency-inference-engine.md#7-data-contracts-analysis-service-api) |
| Engine → DB/Canvas | `Edge[]` (`type`,`evidence`,`overlap_score`) · `Branch[]` (`independent_of[]`) | [data-model: plan_edges, branches](../01-architecture/data-model.md#2-core-tables) |
| Engine → Analysis | per-node resolved touch_set + blast radius | `node_annotations` input |
| Analysis → DB/Inspector | `node_annotations` (5 sections) + `widget_specs[]` | [data-model: node_annotations](../01-architecture/data-model.md#2-core-tables) |
| Canvas → Builder | `runs` row (`node_id`/`branch_id`, idempotency key = `runs.id`) | [data-model: runs](../01-architecture/data-model.md#2-core-tables) |
| Builder → Engine | actual diff (drift check) | triggers `replan` re-derivation |

A contract that fails validation is **never persisted**; it goes to the [bounded repair loop](./prompts-and-tools.md#4-output-schema-enforcement) (re-prompt with the validation error, ≤2 retries) before the run is marked `failed`.

## 5. Where each agent runs

| Stage | Runtime | Queue | Why there |
|-------|---------|-------|-----------|
| Analysis service | **Python / FastAPI** microservice | — (sync HTTP, Redis-cached) | tree-sitter + networkx; CPU-heavy parse off the Node loop |
| Planner | Node worker + **Anthropic TS SDK** | `queue:plan-build` | shares types with app; one agent-loop runtime |
| Engine | **Node worker** (deterministic code) | `queue:plan-build` | pure function over resolved touch-sets; no model |
| Analysis/Annotation | Node worker + Anthropic SDK | `queue:analysis` | fan-out per node; async; streams to inspector |
| Builder | Node worker + Anthropic SDK + **git worktree** | `queue:node-run` | needs worktree I/O + sandbox; one per branch |
| Integration | Node worker + git | `queue:integration` | merge + test gate at reconvergence |
| Replan/Drift | Node worker + Anthropic SDK | `queue:replan` | structure on Opus, edits on Sonnet |

All LLM-bearing stages share the [prompt + tool spec](./prompts-and-tools.md) and the **cached repo-context block**.

## 6. Model selection

| Agent | Model | Rationale |
|-------|-------|-----------|
| Planner | **Opus 4.8** | Deep decomposition + granularity judgment; structure correctness dominates cost. |
| Engine | *(no model)* | Deterministic graph computation. |
| Analysis/Annotation | **Opus 4.8** | Trust-critical; grounded reasoning over engine evidence. |
| Builder | **Sonnet 4.6** | High-volume, cost-sensitive tool-use build loop. |
| Integration | **Sonnet 4.6** | Mechanical merge/conflict reasoning; escalate to Opus on hard conflicts. |
| Replan/Drift | **Opus 4.8** (structure) / **Sonnet 4.6** (incremental edits) | Balance latency & cost; full re-tier on Opus, local edits on Sonnet. |
| Widget-spec generation | **Sonnet 4.6** | Emits validated `WidgetSpec`s, not prose. |

Models are **pluggable** behind one internal interface but tuned/evaluated against these defaults (per [tech-stack §6](../01-architecture/tech-stack.md#6-claude-reasoning)).

## 7. Shared concerns (cut across every agent)

- **Prompt caching of repo context.** The symbol summaries / conventions / framework-surface block is cached once per `{project, commit}` and reused across Planner, Analysis, Builder, Replan on that plan — large cost/latency win. Spec: [prompts-and-tools.md §5](./prompts-and-tools.md#5-prompt-caching-strategy).
- **Schema-forced tool outputs.** No agent emits free prose where structure is required; outputs are tool-forced JSON validated by zod/pydantic. No raw HTML ever ([guardrails](./prompts-and-tools.md#6-guardrails)).
- **Retries / repair.** Validation failure → re-prompt with the error → ≤2 bounded retries → `failed` run with a captured reason; never a silent bad write.
- **Cost / latency budgets.** First-plan render < ~30s (G2); incremental re-plan < ~8s (G2). Per-org token buckets (`ratelimit:org:{id}`); every `runs` row records `tokens` + `cost`.
- **Idempotency.** `runs.id` is the execution idempotency key — a re-queued run that already `succeeded` is a no-op ([data-model §8](../01-architecture/data-model.md#8-indexing--integrity-notes)). Engine derivation is a pure function of `{resolved touch-sets, ratification state}` and is safe to recompute.
- **Versioning.** Every re-plan/drift writes a `plan_revisions` row; nothing is silently overwritten; the canvas can render any historical revision.
- **Asymmetric caution.** A cross-system stance, owned by the engine but honored by every agent: when uncertain, **declare a dependency** (lost parallelism is cheap; a corrupted merge is not).

## 8. End-to-end trace (one G2 request)

1. User: "Add OAuth login." → `plans` row (`status=planning`), `queue:plan-build` job.
2. Analysis service indexes (or warm-cache hits) → symbol/import/call graphs.
3. **Planner (Opus)** emits 5 Nodes (migration, api_contract, ui_component, config, test) + predicted touch_sets + `LayoutSpec{tier:g2_meso, canvas:compact_dag}`.
4. **Engine** resolves touch-sets, derives Edges, finds `config:providers` independent of the UI branch, partitions 2 Branches, flags none false-independent. Plan persisted; canvas renders.
5. **Analysis (Opus)** fans out per node (async), streams Assumptions/Analysis/Benefits/Notable + `WidgetSpec[]` into the inspector with `grounded_refs`.
6. User ratifies branch independence → clicks **Run branch A**. **Builder (Sonnet)** runs each node on a worktree; diffs stream via `stream:run:{id}`.
7. Branches reconverge → **Integration** merges + runs tests.
8. User adds context → **Replan** writes revision 2.

## To-do list

- [ ] Define the typed contract objects (zod + pydantic + shared JSON Schema) for each hand-off in §4.
- [ ] Stand up the four BullMQ queues (`plan-build`, `node-run`, `analysis`, `integration`) + `replan`, with idempotent consumers keyed on `runs.id`.
- [ ] Implement the synchronous Planner→Engine path on `queue:plan-build` within the < ~30s G2 budget.
- [ ] Wire the async Analysis fan-out (`queue:analysis`) to stream into the inspector via Realtime/Redis.
- [ ] Implement the model-selection interface with per-agent defaults from §6 and a pluggable override.
- [ ] Implement the shared bounded-repair loop (validation error → re-prompt → ≤2 retries → `failed`).
- [ ] Add per-agent cost/latency budgets + `ratelimit:org` enforcement; record `tokens`/`cost` on every `runs` row.
- [ ] Add OpenTelemetry spans across web→api→workers→analysis for each pipeline stage.
- [ ] Author the end-to-end demo trace fixture (§8) for the `D17` demo.

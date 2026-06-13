# Shared Prompts & Tools

> Status: **Canonical.** The shared prompt structure, tool catalog, output-schema enforcement, prompt-caching strategy, guardrails, and per-agent prompt skeletons used by **every** Trellis agent — the substrate the [Planner](./planner-agent.md), [Analysis](./analysis-annotation-agent.md), Builder, and Replan agents are built on.
>
> **Amended by [mandated-integrations.md](../01-architecture/mandated-integrations.md)** — the tool catalog gains **Linkup** (external web grounding) alongside the analysis-service / file / git / test tools; Linkup evidence is tagged `web:linkup` (vs `repo-symbol`). See §3.3.

## 1. Principle

Every agent is a **tool-use loop with a forced final output**, not a free-form chat. Three rules hold across all of them ([overview §7](./overview.md#7-shared-concerns-cut-across-every-agent)):

1. **Structure is forced.** Final outputs are tool-forced JSON validated by zod (TS) ↔ shared JSON Schema ↔ pydantic (Py). Free prose is allowed only inside `rationale`/`text` fields.
2. **Reality comes from tools.** Symbols, callers, overlaps, and diffs come from the [analysis service](./dependency-inference-engine.md#7-data-contracts-analysis-service-api) and git — never from model memory.
3. **Repo context is cached once.** The expensive context block is built per `{project, commit}` and reused via prompt caching across every agent on the plan.

## 2. Tool catalog

All tools are schema-validated (input + output) and shared across agents; each agent is granted a **subset** (least privilege). Output schemas are the same JSON Schemas used for persistence.

### Analysis-service tools (read-only; Python/FastAPI, Redis-cached) — [engine §7](./dependency-inference-engine.md#7-data-contracts-analysis-service-api)

| Tool | Input | Output |
|------|-------|--------|
| `index` | `{ project_id, commit }` | `{ index_id, stats }` |
| `symbol_graph` | `{ project, commit }` | `{ symbols, imports, calls, types }` |
| `resolve_touchset` | `{ commit, predicted_touchset }` | `{ resolved, blast_radius, confidence }` |
| `overlap` | `{ commit, touchset_a, touchset_b }` | `{ overlap_score, shared:{files,symbols,schema,config} }` |
| `callgraph_impact` | `{ commit, symbol, kind:"signature"|"body" }` | `{ affected_symbols[], affected_files[] }` |

### Workspace & execution tools

| Tool | Input | Output | Granted to |
|------|-------|--------|-----------|
| `file_read` | `{ path, range? }` | `{ content }` | all |
| `file_write` | `{ path, content }` | `{ ok }` | Builder only (inside worktree) |
| `apply_patch` | `{ unified_diff }` | `{ applied, conflicts? }` | Builder only |
| `test_runner` | `{ cmd?, paths? }` | `{ passed, failed, report }` | Builder, Integration |
| `git` | `{ op:"diff"|"status"|"merge"|"commit", … }` | op-specific | Builder, Integration |
| `worktree` | `{ op:"create"|"remove", branch_id }` | `{ worktree_path }` | Builder, Integration (orchestrator-mediated) |

**Boundaries:** read-only agents (Planner, Analysis, Replan-structure) get only analysis-service + `file_read`. Mutating tools (`file_write`, `apply_patch`, `git merge/commit`, `worktree`) are **Builder/Integration only**, always inside a per-branch worktree under the `lock:file` backstop ([engine §4.3](./dependency-inference-engine.md#4-the-honesty-guarantees-non-negotiable)). `worktree`/`git` lifecycle is orchestrator-mediated, not free-hand.

## 3. System-prompt structure & cached repo-context block

Every agent prompt is assembled in this order; the **first two blocks are cacheable**, the rest are per-call:

```
┌─ [CACHE] Trellis system preamble ─────────────────────────┐
│  role · the LLM-proposes/tools-decide split · honesty      │
│  guarantees · "no raw HTML" · "ground or flag"             │
├─ [CACHE] Repo-context block (per {project, commit}) ───────┤
│  • symbol summaries (top modules, exports, key types)      │
│  • conventions (file layout, naming, test framework,       │
│    migration tooling, lint rules)                          │
│  • framework surfaces (routers, DI, env/config, migrations)│
├─ [per-call] Agent-specific instructions + few-shot ────────┤
├─ [per-call] Task payload (prompt / node / touch-set / diff)│
├─ [per-call] Negative guidance (suppression rules, if any)  │
└─ [forced] Tool definitions + the required emit_* tool ─────┘
```

The repo-context block is the same data the [Planner reads for conventions](./planner-agent.md#7-prompt-design-notes) and the [Analysis agent grounds against](./analysis-annotation-agent.md#3-grounding-procedure-the-core-mechanism). Built from the analysis service's symbol graph + framework-surface detection; sized to fit the cache budget (summaries, not full source).

## 4. Output-schema enforcement

1. **Tool-forced JSON.** Each agent has exactly one terminal `emit_*` tool (`emit_plan`, `emit_annotations`, `emit_build_result`, `emit_replan`); the loop ends only by calling it.
2. **Dual validation.** Output validated by zod (Node) against the shared JSON Schema; the Python service validates its own I/O with pydantic against the *same* schema. Names per [data-model](../01-architecture/data-model.md).
3. **Bounded repair retries.** On validation failure, re-prompt with the **exact validator error** appended; **≤2 retries**; then mark the `runs` row `failed` with the captured error. No partially-valid output is ever persisted.
4. **Ref-resolution check (Analysis).** Beyond shape, every `grounded_refs` entry must resolve in the symbol graph; unresolved refs are rejected and force the claim to low-confidence or repair ([analysis §3](./analysis-annotation-agent.md#3-grounding-procedure-the-core-mechanism)).

## 5. Prompt-caching strategy

- **What's cached:** the system preamble + the per-`{project, commit}` repo-context block (the two `[CACHE]` blocks above).
- **Reuse:** every agent call on a plan (Planner, all per-node Analysis fan-out, Builder steps, Replan) shares the cached prefix — the largest token block is paid for **once** per commit, not per call.
- **Invalidation:** keyed by `{project, commit}`; a new `base_commit` (or re-index) rebuilds the block. Aligns with `cache:symbolgraph:{project}:{commit}` ([data-model §6](../01-architecture/data-model.md#6-redis-key-schema)).
- **Cost effect:** the highest-leverage cost lever in the system — Analysis fan-out over N nodes amortizes one cached context across N calls. Per-call `tokens`/`cost` still recorded on each `runs` row.

## 6. Guardrails

- **No raw HTML / no raw UI.** Agents emit validated `LayoutSpec`/`WidgetSpec` against the component registry; unknown widget or invalid props → safe fallback, never model HTML ([granularity-layouts §5](../03-generative-ui/granularity-layouts.md#5-how-layouts-are-generated-the-genui-mechanism)).
- **Ground or flag.** Every analysis claim cites a real symbol/file or is labeled low-confidence; unresolved ref → rejected ([analysis §3](./analysis-annotation-agent.md#3-grounding-procedure-the-core-mechanism)).
- **Asymmetric caution toward dependencies.** When uncertain about independence, **declare a dependency / `soft_order`** — never assert parallel-safety on a guess. Lost parallelism is cheap; a corrupted merge is not ([engine §4](./dependency-inference-engine.md#4-the-honesty-guarantees-non-negotiable)).
- **Least-privilege tools.** Each agent gets only the tools its role needs (§2); only Builder/Integration mutate, only inside a worktree under `lock:file`.
- **No silent overwrite.** Re-plan/drift writes a new `plan_revisions`; `runs.id` idempotency prevents double-execution.
- **Cost guards.** Per-org token bucket (`ratelimit:org:{id}`) bounds runaway loops; repair retries are capped at 2.

## 7. Per-agent prompt skeletons (templates)

Shared `[CACHE]` blocks (§3) are implicit in each.

**Planner** — [planner-agent.md](./planner-agent.md)
```
Decompose the request into Nodes at the detected granularity {tier}.
Rules: predictions are COARSE ({kind,name,file}); do NOT claim independence
or enumerate callers — the engine resolves that. Don't over-decompose
({tier} guidance). Emit a plan-level LayoutSpec.
Tools: symbol_graph, resolve_touchset (sanity probe), file_read.
→ call emit_plan(detected_granularity, tier_reason, layout_spec, nodes[], coarse_order[])
Few-shot: one worked decomposition for {tier}.
```

**Analysis / Annotation** — [analysis-annotation-agent.md](./analysis-annotation-agent.md)
```
For node {id}, write Assumptions, Analysis(risks), Benefits, Notable symbols.
GROUND EVERY CLAIM: fetch blast radius (callgraph_impact + this node's
Edge.evidence), read cited symbols (file_read/symbol_graph), attach
grounded_refs; anything uncited → confidence<threshold (low-confidence).
Risk entries need kind∈{race_condition,failure_mode,edge_case,perf,security}
+ severity. Reuse engine false-independence flags for conflict risks.
Then emit per-node WidgetSpec[] keyed by change_type, populated with real data.
Negative guidance: {suppression_rules}.
→ call emit_annotations(assumptions[], analysis[], benefits[], notable_symbols[], widget_specs[])
```

**Builder** — [builder-agent.md](./builder-agent.md)
```
Implement node {id} inside worktree {path} for branch {branch_id}.
Stay within the resolved touch_set; if you must touch a file outside it,
STOP and report drift (triggers re-derivation). Run tests before finishing.
Tools: file_read, file_write, apply_patch, test_runner, git, worktree.
→ call emit_build_result(diff_path, tests, touched_files[], drift?, tokens, cost)
```

**Replan / Drift** — [replan-and-drift.md](./replan-and-drift.md)
```
Given {new_context | actual_diff}, recompute only the affected structure.
Opus for re-tier/restructure; Sonnet for local edits. Produce a NEW revision
diffable against the prior; never overwrite. Re-run engine stages 3–6 on
affected nodes.
→ call emit_replan(revision, reason, changed_nodes[], changed_edges[], diff)
```

## To-do list

- [ ] Shared JSON Schemas (zod ↔ pydantic) for `emit_plan`/`emit_annotations`/`emit_build_result`/`emit_replan` + all tool I/O.
- [ ] Tool catalog implementation with per-agent least-privilege grants (§2).
- [ ] System-prompt assembler with the ordered `[CACHE]`/per-call block structure.
- [ ] Repo-context block builder (symbol summaries + conventions + framework surfaces) sized to the cache budget.
- [ ] Prompt-caching wiring keyed on `{project, commit}` with re-index invalidation.
- [ ] Bounded-repair loop (validator error → re-prompt → ≤2 retries → `failed`) shared across agents.
- [ ] Ref-resolution validator for `grounded_refs` against the symbol graph.
- [ ] Guardrail enforcement: registry validation (no raw HTML), ground-or-flag, asymmetric-caution defaults, least-privilege, cost guards.
- [ ] Per-agent prompt skeletons (§7) as versioned templates with few-shot fixtures.
- [ ] Token/cost accounting per `runs` row + `ratelimit:org` enforcement.

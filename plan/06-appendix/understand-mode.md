# Understand Mode — comprehension/evaluation as a future capability

> Status: **PLANNED · ON STANDBY.** Designed but intentionally **deferred**. Do **not** build until the core change/implementation mode is verified end-to-end (connect repo → grounded plan → dispatch → diff/PR). Tracked as [OQ-17](./open-questions.md). This doc is the spec to pick up when that trigger is met.

## Why this exists (the observed gap)

Trellis is, by design, a **change/implementation planner**: the Planner decomposes a *coding request* into a dependency graph of **changes to make** ([planner-agent.md](../02-agent-system/planner-agent.md); `change_type ∈ {migration, api_contract, ui_component, logic, refactor, bugfix, config, infra, test, docs}` — all *change* kinds). There is **no representation for a comprehension intent**.

So a prompt like *"explain / evaluate / document this repo"* has nowhere to go and **collapses to the nearest change** — e.g. a `docs` node *"add a README"* even when a `README.md` already exists. (Grounding still resolves to the real file; the **intent** is the mismatch.) Observed in testing on a connected repo.

**The boundary:** Trellis today answers *"what should I build/change?"* It does not answer *"what is this and is it any good?"* — a **read-only comprehension** intent (explain, evaluate, review, audit, "how does X work").

## The decision

- **Defer.** Get the core change-mode correct and running first (it's the product thesis). 
- When picked up: add an **intent-aware** layer so *understand* prompts produce a **read-only understanding artifact**, not a fake change DAG.

## Proposed design (when unstandby'd)

1. **Intent classification** — a cheap pre-step (in `plan-build` before the Planner, or a thin classifier agent) tags the prompt `change` vs `understand`. `change` → today's pipeline, unchanged.
2. **Repo Analyst agent** (`apps/workers/src/agents/analyst.ts`, new) — for `understand`, produce a grounded, read-only artifact. **No "add a file" nodes.**
3. **Render — architecture map (recommended, on-thesis).** Reuse the canvas: **nodes = modules/subsystems, edges = real import dependencies** straight from the analysis service `/symbol-graph` (imports/calls already exist). Each node is annotated by Opus with *purpose · key files/symbols · risks · evaluation*. This keeps the "output is an operable graph, not prose" thesis. *(Alternative: a structured overview report in the inspector — simpler, less graph-native.)*

**Why feasible now:** the repo index already extracts everything needed — `/symbol-graph` returns the module/import/call graph + symbols; `repo-summary.ts` has the file tree + conventions. Understand mode is mostly **new intent + render over existing data**, not new infrastructure.

## Implementation sketch (files)

- `apps/workers/src/workers/plan-build.ts` — branch on intent; route `understand` to the analyst flow.
- `apps/workers/src/agents/analyst.ts` (new) — consume `/symbol-graph` + repo summary → emit module nodes + dependency edges + per-module annotations (Opus, tool-forced, same `toolForcedJSON` pattern).
- `packages/shared` — a plan **`mode: "change" | "understand"`** discriminator (and/or a node `kind`), so the canvas can render read-only; or a separate `understandings` entity. Decide at build time.
- `apps/web/components/canvas/*` — read-only rendering affordance for understanding plans (no Run/Dispatch; "Open file"/"Explain" affordances instead).
- `03-generative-ui` — a read-only layout variant for the architecture map.

## Companion near-term guardrail (small; improves core too — do with core hardening)

Independent of full Understand mode, the Planner should:
- **Never propose adding a file/symbol that already exists** in the resolved index (grounding check) — the README case.
- **Detect a non-change prompt** and, rather than inventing a change, surface a one-line notice ("This looks like an analysis request — Understand mode is coming; for now, rephrase as a change") — a minimal intent guard.

This is the smallest slice and can ship with the core change-mode (see [OQ-17](./open-questions.md)).

## Trigger to start & acceptance

- **Trigger:** core change-mode verified end-to-end on a real connected repo (connect → grounded plan → dispatch a node → diff/PR).
- **Acceptance (Understand mode):** an `understand` prompt yields a navigable architecture/module map grounded in real imports/symbols (no fabricated changes); change prompts are unaffected.

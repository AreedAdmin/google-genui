# Testing & Eval Strategy

> Status: **Canonical.** Defines the full quality strategy — standard testing, **the dependency eval harness (D15)** with False-Independence Rate as the primary safety metric, generative-UI testing, CI gates, and instrumentation.

The thesis ([`../README.md`](../README.md)) is that the product is a *dependency-reasoning and parallel-orchestration system with a generative UI on top* — so the quality strategy is **weighted toward the engine, not the UI**. The eval harness implements D15 ([`../00-overview/deliverables.md`](../00-overview/deliverables.md)) and the metrics named in [`../02-agent-system/dependency-inference-engine.md` §8](../02-agent-system/dependency-inference-engine.md). The harness lives in `eval/` ([`repo-structure.md` §1](./repo-structure.md)).

---

## 0. Quality philosophy

1. **The primary metric is False-Independence Rate (FIR), and its target is near-zero.** A false dependency only costs lost parallelism; a **false independence costs a corrupted merge** ([`../02-agent-system/dependency-inference-engine.md` §1, §4.2](../02-agent-system/dependency-inference-engine.md)). The entire gate hierarchy reflects this asymmetry: FIR is a hard merge-blocker; most other metrics are soft or trending.
2. **Grounding is testable.** Every analysis/dependency claim cites a real symbol/file or is `low-confidence` (D5/AC2). We measure the *grounding rate* and the *hallucination rate* directly against the symbol graph.
3. **Generated UI is validated, not raw (ADR-5).** Widget/layout specs are checked against the component registry; UI testing fuzzes specs and asserts the registry rejects anything off-allow-list.
4. **The harness is a development tool, not a finale.** D15 v0 lands with the engine (M2 in [`milestones-and-phases.md`](./milestones-and-phases.md)) so every engine change is FIR-gated from birth; it completes in M8.

---

## 1. Standard testing

### (a) Unit
| Side | Tool | Covers |
|------|------|--------|
| **TS** | Vitest | edge-derivation rules (Stage 4), overlap classifier (Stage 5), DAG builder + cycle-breaking + branch partition, confidence propagation, conflict-resolution strategies (serialize/split/hoist), Redis-key construction, zod validators, registry resolution. |
| **Python** | pytest | tree-sitter symbol/import/call/type extraction, resolve-touchset matching + new-symbol detection, blast-radius expansion (callers, signature call-sites, type refs, schema/config consumers), overlap scoring, reachability/cycle algorithms, framework-surface detectors. |

The dependency core ([`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md) §3 Stages 4–6) is **deterministic given resolved touch-sets**, so it is heavily unit-tested with hand-built touch-set fixtures — no LLM in the loop for these tests.

### (b) Integration (API + queues + locks)
- **API + queue:** post `/plans` → assert `plan-build` enqueued → worker drains → Nodes/Edges/Branches persisted (Flow A, [`../01-architecture/high-level-architecture.md` §3](../01-architecture/high-level-architecture.md)). Real Redis + local Supabase, stubbed Claude.
- **Locks / conflict guard (the safety net):** two concurrent `node-run`s touching the same path → assert `lock:file:{project}:{path}` blocks/serializes the second with a visible reason ([`../02-agent-system/dependency-inference-engine.md` §4.3](../02-agent-system/dependency-inference-engine.md)); dead-worker lock TTL expiry re-queues the run idempotently (keyed on `runs.id`).
- **Worktree isolation:** assert each branch builds in its own git worktree and diffs don't cross (ADR-3).
- **Idempotency:** re-queue a `succeeded` run → no-op.

### (c) End-to-end (Playwright over the canvas)
- The spine ([`../00-overview/scope.md` §2](../00-overview/scope.md)): onboard repo → plan a G2 feature → open a node (five sections render) → Run a node → diff streams in → run an independent branch in parallel → integration node merges. Drives D9/D10/D11/D12 through the real UI.
- Realtime: two browser contexts see live node/edge/run updates + presence (D12).
- The D17 demo script is itself an e2e spec across all four granularities ([`milestones-and-phases.md` M10](./milestones-and-phases.md)).

### (d) Contract tests (the cross-language boundary)
- For each schema in `contracts/schemas/` ([`repo-structure.md` §2](./repo-structure.md)): a golden JSON fixture is validated by **both** the generated zod (TS) and the generated pydantic (Py); a round-trip asserts identical parse on both sides.
- `contracts:check` gate: regenerate zod+pydantic → `git diff --exit-code` (no hand-edits, no drift).
- Analysis-service API contract: `resolve-touchset`/`overlap`/`callgraph-impact`/`symbol-graph`/`index_repo` request+response validated against their schemas in CI.

---

## 2. The agent / dependency EVAL HARNESS (D15) — the core

Located in `eval/`. **This is the make-or-break test surface.** It runs in CI and gates merges.

### 2.1 Golden repos
- A set of real-ish TS/JS repos with **hand-labeled change-sets** and **known dependency graphs**: for a given prompt, the expected Nodes, the ground-truth Edges (with reasons), and the ground-truth Branch partition (which pairs are *truly* independent vs *truly* conflicting on execution).
- Each golden case records: prompt, base commit, expected touch-sets, expected edges, expected independent/dependent branch pairs, and (where runnable) the *actual* merge outcome of dispatching the "independent" pairs in parallel — the ground truth for FIR.
- Span all four granularities (G1–G4) and the change types that drive widgets.

### 2.2 Metrics
| Metric | Definition | Why it matters |
|--------|------------|----------------|
| **False-Independence Rate (FIR)** — *PRIMARY* | fraction of branch pairs the engine called `independent` that actually conflict on execution (shared file / mutated symbol / changed signature / schema/config key) | The one metric that, if non-zero, makes parallelism dangerous. **Near-zero target; hard merge gate.** |
| **Dependency precision** | of edges the engine asserted, fraction that are real (in the label) | over-claiming dependencies costs parallelism |
| **Dependency recall** | of real edges in the label, fraction the engine asserted | missing a real edge is a (potential) false independence |
| **Parallel-merge-clean rate** | of parallel dispatches the engine green-lit, fraction that merge clean + pass the test gate | the executable proof FIR is honest (D6/D7) |
| **Analysis grounding rate** | fraction of analysis/dependency claims that cite a real symbol/file (vs `low-confidence`) | D5/AC2 trust bar |
| **Hallucination rate** | fraction of grounded claims whose cited symbol/file does **not** exist in the graph | trust-critical; below threshold (D5/AC2) |
| **Parallel speedup** | wall-clock parallel ÷ sequential on G3 plans | the economic-value proof (D6/D7) |
| **Resolution confidence calibration** | does `resolution_confidence` predict actual resolution correctness? | feeds asymmetric-caution defaults |

### 2.3 Adversarial cases (the suite that makes FIR honest)
Every case is designed so a naive LLM "are these independent?" guess fails but the grounded engine catches it ([`../02-agent-system/dependency-inference-engine.md` §8](../02-agent-system/dependency-inference-engine.md)):

| Adversarial case | Trap | Engine must |
|------------------|------|-------------|
| **Hidden shared config** | two nodes look disjoint but both read/write the same env/DI/config key | flag via `shared_config_key` overlap; cite the key |
| **Transitive type change** | A changes a type, B uses a symbol that references that type | derive `data_flow`/`schema_dependency` via the type graph |
| **Same-file disjoint edits** | two nodes edit the same file in non-overlapping regions | flag `file_overlap > 0` → serialize/lock-and-merge (no naive "independent") |
| **Migration ordering** | B's migration must run after A's | derive `sequence` hard edge; never parallelize |
| **Dynamic dispatch / reflection** | dependency invisible to the static graph | mark "low static confidence" → conservative serialize (§9 of the engine doc) |

### 2.4 How it runs
- `pnpm eval` (`eval/runner/`): for each golden case, run Planner → analysis-service resolution → dependency engine → compare against labels; for runnable cases, dispatch the green-lit "independent" pairs on worktrees and record actual merge outcomes for FIR + parallel-merge-clean.
- LLM stages run with **fixed seeds/temperature and prompt-cached context** for reproducibility; engine stages are deterministic.
- Results emit a JSON report + a markdown summary; trends are tracked over time (regression detection, §4).

---

## 3. Generative-UI testing

### (a) Visual regression — per granularity tier × change-type
- A matrix: **{G1, G2, G3, G4} × {migration, api_contract, ui_component, logic, refactor, …}** rendered from canonical plan fixtures; screenshot-diffed (Playwright). Catches layout regressions in D11 (diff-first / compact / swimlane / zoomable) and the four+ change-type widgets (schema-diff, api-contract, component-preview, call-graph-impact).
- Asserts G1 collapses the DAG to a checklist; G4 clusters into expandable super-nodes — the layout = `f(granularity × change_type × context)` contract (D11/AC3).

### (b) Widget schema fuzzing
- Fuzz `widget-spec` JSON against the registry (`packages/ui` `validateWidgetSpec`): malformed, off-allow-list, and injection-shaped specs must be **rejected** — never rendered (ADR-5: no raw model HTML). Asserts the validated-spec boundary holds.

### (c) Accessibility (a11y)
- axe-core checks on the inspector, canvas controls, and each widget; keyboard navigation of the DAG; focus management in the node inspector and conflict-resolution UI (D7). Color is never the *only* status/edge-type signal (D9 nodes colored by status & change-type — assert a non-color affordance too).

---

## 4. CI gates — which metrics block merge

| Gate | Metric / check | Threshold | Blocks merge? |
|------|----------------|-----------|---------------|
| **G-FIR** | False-Independence Rate | ≤ target (near-zero, §5) | **YES — hard** |
| **G-merge** | Parallel-merge-clean rate | ≥ target | **YES** |
| **G-halluc** | Hallucination rate | ≤ target | **YES** |
| **G-recall** | Dependency recall | ≥ target | YES (recall guards FIR) |
| **G-contract** | `contracts:check` + contract round-trip tests | pass | **YES** |
| **G-unit** | TS + Py unit + integration (locks/queues) | pass | **YES** |
| **G-precision** | Dependency precision | ≥ target | soft (warn + trend) |
| **G-ground** | Analysis grounding rate | ≥ target | soft (warn + trend) |
| **G-speedup** | Parallel speedup (G3) | ≥ target | soft (report on PR) |
| **G-visual** | Visual-regression matrix | no unreviewed diff | YES for `packages/ui`/`apps/web` |
| **G-a11y** | axe-core critical violations | zero | YES for UI paths |

- **Regression catching.** Every PR runs G-unit/G-contract/G-visual/G-a11y; the eval harness (G-FIR/G-merge/G-recall/…) runs on PRs touching `workers/src/dependency/`, `services/analysis/`, `packages/agent-core`, prompts, or `eval/`, and on a nightly full sweep. Metric trends are stored; a statistically meaningful drop in a soft metric opens an alert even when it doesn't block.
- **The asymmetry is encoded in the gates:** recall is hard (missing an edge risks a false independence) while precision is soft (over-claiming only costs parallelism) — directly mirroring the engine's asymmetric-caution stance.

## 5. Target numbers

> Final targets are ratified in [`../00-overview/success-metrics.md`](../00-overview/success-metrics.md); these are the canonical bars this harness enforces. `X`-style placeholders there resolve to the values below.

| Metric | Target | Gate |
|--------|--------|------|
| **False-Independence Rate (FIR)** | **≤ 1%** (aspirationally 0) on the golden set incl. adversarial cases | hard |
| Parallel-merge-clean rate | **≥ 95%** of green-lit parallel dispatches | hard |
| Hallucination rate (cited symbol doesn't exist) | **≤ 1%** | hard |
| Dependency recall | **≥ 0.95** | hard |
| Dependency precision | **≥ 0.85** | soft |
| Analysis grounding rate (claims cited, not `low-confidence`) | **≥ 0.90** | soft |
| Parallel speedup (G3, vs sequential) | **≥ 2× wall-clock** | soft/report |
| First-plan render (G2) | **< 30s**; incremental re-plan **< 8s** ([`../00-overview/scope.md` §8](../00-overview/scope.md)) | perf gate |
| a11y critical violations | **0** | hard (UI) |

These tie to acceptance criteria: D4/AC5 (dependency accuracy), D5/AC2 (grounding/hallucination), D6/D7 (merge-clean + speedup), D8/AC1 (re-plan latency), D11/AC3 (validated specs), D15/AC1 (the harness in CI).

## 6. Instrumentation (PostHog + OTel)

- **OpenTelemetry** traces span web → api → workers → analysis ([`../01-architecture/tech-stack.md` §7](../01-architecture/tech-stack.md)). Each agent stage (plan / resolve / derive-edges / classify / build / integrate) is a span with token/cost/latency attributes, so the **online** equivalents of the eval metrics (e.g. real-world parallel-merge-clean rate, drift-re-derivation frequency) are observable in production, not just in CI.
- **PostHog** captures product analytics + LLM cost: plan-creation funnel, ratification actions (confirm/add/split), thumbs-up/down on analysis claims (feeds D5 suppression), per-model token spend (Opus vs Sonnet), and run cost per node. Down-vote rate is the online proxy for the offline grounding/usefulness metrics.
- **Online ↔ offline loop.** Production drift events and merge conflicts on "independent" branches are harvested as new golden/adversarial cases, so the eval set grows from real failures — the harness never goes stale.

---

## To-do list

### Standard testing
- [ ] Vitest unit suites for edge-derivation, overlap classifier, DAG/branch partition, conflict strategies, confidence propagation, registry resolution.
- [ ] pytest unit suites for parse, resolve-touchset, blast-radius, overlap, surface detectors.
- [ ] Integration tests: API↔queue (Flow A), `lock:file` conflict guard, worktree isolation, run idempotency on `runs.id`.
- [ ] Playwright e2e over the spine (onboard → plan → inspect → run → parallel → integrate) + realtime two-context test.
- [ ] Contract tests: per-schema zod↔pydantic round-trip; `contracts:check` gate; analysis-service API contract checks.

### Dependency eval harness (D15)
- [ ] `eval/golden-repos/` — hand-labeled change-sets + dependency graphs across G1–G4.
- [ ] `eval/adversarial/` — hidden shared config, transitive type change, same-file disjoint edits, migration ordering, dynamic dispatch.
- [ ] `eval/runner/` — compute FIR, dependency precision/recall, parallel-merge-clean rate, grounding rate, hallucination rate, speedup, confidence calibration.
- [ ] Runnable-case dispatch: execute green-lit "independent" pairs on worktrees → record actual merge outcomes for FIR + merge-clean.
- [ ] Reproducibility: fixed seeds/temperature + prompt-cached context for LLM stages; deterministic engine stages.

### Generative-UI testing
- [ ] Visual-regression matrix: {G1,G2,G3,G4} × change-types (Playwright screenshot diff).
- [ ] Widget-spec fuzzing against the `packages/ui` registry (reject off-allow-list / malformed / injection-shaped specs).
- [ ] axe-core a11y checks (inspector, canvas, widgets, conflict UI) + keyboard nav + non-color status affordances.

### CI gates & instrumentation
- [ ] Wire gates per §4 (hard: FIR, merge-clean, hallucination, recall, contract, unit, visual, a11y; soft: precision, grounding, speedup).
- [ ] Path-scoped eval runs (engine/analysis/agent-core/prompts/eval) + nightly full sweep; metric-trend storage + regression alerts.
- [ ] Ratify §5 targets against [`../00-overview/success-metrics.md`](../00-overview/success-metrics.md).
- [ ] OTel spans per agent stage with token/cost/latency; PostHog plan funnel + ratification + thumbs + cost dashboards.
- [ ] Online→offline loop: harvest production drift/merge-conflict events into new golden/adversarial cases.

# Success Metrics

> Status: **Canonical.** Defines the concrete KPI targets, how each is instrumented, and how the metrics map to the four assessment criteria — so "good" is measurable, not asserted.

All numeric targets are **v1 / demo-ready bars** unless marked *(stretch)*. Instrumentation stack: **PostHog** (product analytics + LLM cost events), **OpenTelemetry** (traces across web→api→workers→analysis, latency), and the **eval harness** (golden-repo correctness gates in CI, see [`../05-implementation/testing-and-eval.md`](../05-implementation/testing-and-eval.md)). Entity/field names referenced are from [`../01-architecture/data-model.md`](../01-architecture/data-model.md).

**North star** (from [`vision-and-positioning.md`](./vision-and-positioning.md)): *parallel-merge-clean throughput* — plan-nodes dispatched in parallel on proven-independent branches that merge cleanly on first integration, per active project per week. Every section below either feeds or guards it.

---

## (a) Safety & correctness — *the bar the product lives or dies on*

| KPI | Definition | Target | Instrumented via |
|-----|------------|--------|------------------|
| **False-Independence Rate (FIR)** ⭐ *primary* | Fraction of branch-pairs marked `independent` that actually conflict on real parallel execution (shared file, mutated symbol, changed signature, schema/config key). | **≤ 1%** (v1); **≤ 0.3%** *(stretch)* — "near-zero" | Eval harness: parallel-execute golden plans, diff worktrees for true overlap; live: `integration_nodes.conflict_report` cross-checked against branch `independent_of`. |
| **Dependency precision** | Of edges the engine asserts, fraction that are real dependencies. | **≥ 0.92** | Eval harness vs human-labeled golden DAGs. |
| **Dependency recall** | Of real dependencies, fraction the engine found. | **≥ 0.95** (recall favored — a missed edge is a corrupt merge). | Eval harness vs golden DAGs. |
| **Parallel-merge-clean rate** | Of parallel-dispatched independent branches, fraction whose integration node merges with green tests, no human conflict resolution. | **≥ 95%** | `integration_nodes.status = merged` with clean `conflict_report` / total parallel integrations (PostHog event + OTel). |
| **Drift-caught-before-merge rate** | Of build-discovered new dependencies, fraction re-derived *before* a corrupt merge (D8). | **≥ 99%** | Eval drift fixtures + production `events` of type `drift_detected` preceding any `conflicted` integration. |

> FIR is the single most important number in the entire plan. It is reported per granularity tier (G1–G4); FIR must hold at G3/G4 where the engine is most stressed.

## (b) Value — *does it save real money/time*

| KPI | Definition | Target | Instrumented via |
|-----|------------|--------|------------------|
| **Parallel speedup (G3)** | Wall-clock for a G3 plan executed in parallel ÷ same plan executed sequentially. | **≥ 2.5×** median; **≥ 3.5×** *(stretch)* on highly-parallel plans | OTel span durations: sum(sequential node runtimes) vs critical-path runtime of the actual parallel run. |
| **Review-time saved** | Reduction in human review time for a change vs no-Trellis baseline, attributable to grounded analysis (P2). | **≥ 30%** self-reported + measured | PostHog timing + design-partner survey; A/B where feasible. |
| **Delegation throughput** | Subtrees delegated and merged back per active plan per week. | **≥ 2** on G3+ plans | `delegations.status = merged` count (PostHog). |
| **Nodes per parallel wave** | Avg count of nodes safely dispatched concurrently in one wave. | **≥ 4** (G3), **≥ 12** (G4) | `runs` started within a dispatch window sharing a wave id. |

## (c) Trust — *will people believe and run the plan*

| KPI | Definition | Target | Instrumented via |
|-----|------------|--------|------------------|
| **Analysis thumbs-up rate** | Up-votes ÷ total votes on annotation claims (`feedback` table). | **≥ 80%** | `feedback.vote` aggregated (PostHog + Supabase). |
| **Grounding rate** | Fraction of analysis/assumption claims that carry a valid, resolvable symbol/file citation. | **≥ 95%** (rest must be labeled `low-confidence`). | Eval harness validates `grounded_refs[]` resolve to real symbols. |
| **Hallucination rate** | Fraction of claims citing a non-existent or wrong symbol/behavior. | **≤ 2%**; **≤ 0.5%** *(stretch)* | Eval harness symbol-resolution + spot human audit. |
| **Ratification rate** | Fraction of plans where the user accepts the DAG without overriding ≥ 1 edge. | tracked, no hard target (healthy ~60–85%; *too high* may mean users aren't reading). | `events` of type `edge_override`. |

## (d) Product & engagement

| KPI | Definition | Target | Instrumented via |
|-----|------------|--------|------------------|
| **Plans created / active user / week** | Activation & habit. | **≥ 3** (Phase A dogfood) | PostHog `plan_created`. |
| **Run-through rate** | Fraction of created plans where ≥ 1 node is actually run (`runs` exist). | **≥ 60%** | PostHog funnel `plan_created → node_run`. |
| **Re-plan iterations / plan** | Iteration depth (healthy band, not "more is better"). | **2–5** typical | `plan_revisions` count per plan. |
| **Time-to-first-plan** | Describe → first rendered plan. | **< 30s** (G2), per [`scope.md`](./scope.md) §8 | OTel end-to-end span. |
| **Incremental re-plan latency** | Add-context → re-flowed plan. | **< 8s** (G2) | OTel span. |

## (e) Cost — *unit economics by tier*

Cost is sourced from `runs.tokens` / `runs.cost` and `node_annotations.cost`, tagged by tier, surfaced in PostHog LLM cost dashboards. Model split per [`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md) (Opus 4.8 plan/analysis, Sonnet 4.6 build), with prompt caching on the repo-context block.

| Tier | Nodes | Cost / plan (plan+analysis, no build) | Cost / full run (incl. build) | Notes |
|------|-------|---------------------------------------|-------------------------------|-------|
| **G1 Micro** | 1–3 | **≤ $0.15** | **≤ $0.50** | Must stay cheap or G1 isn't worth it. |
| **G2 Meso** | 4–15 | **≤ $0.75** | **≤ $3** | The sweet spot; optimize hardest here. |
| **G3 Macro** | 15–50 | **≤ $4** | **≤ $20** | Prompt caching critical. |
| **G4 Mega** | 50+ | **≤ $15** *(planning)* | **≤ $100** *(guard-capped)* | Cost guard (`ratelimit:org:{id}`) enforces a hard ceiling; clustered analysis, not per-node. |

Additional cost KPIs: **cache hit rate on repo-context block ≥ 70%**; **cost / merged-node** trended over time (should fall as caching/Sonnet usage tunes).

## (f) Mapping to the four assessment criteria

Criteria are defined in [`deliverables.md`](./deliverables.md). Each is measured, not asserted:

| Criterion | Measured by | Pass bar |
|-----------|-------------|----------|
| **Originality** | Demonstrated triad (DAG + generated per-context UI + subtree delegation) running end-to-end; FIR (a) proving the parallel DAG is *real*, not cosmetic; delegation throughput (b). | D17 demo runs clean across G1–G4; FIR ≤ 1%; ≥ 1 subtree delegated + merged live. |
| **Economic value** | Parallel speedup ≥ 2.5× (b); review-time saved ≥ 30%; delegation throughput ≥ 2. | All three thresholds met on G3 golden plans + design-partner data. |
| **Technical difficulty** | Dependency precision/recall + FIR + drift-caught rate (a); parallel-merge-clean ≥ 95%; conflict-free orchestration under heavy G4 fan-out. | Eval gates green in CI; G4 fan-out (UC-6) safe at target concurrency. |
| **Generative UI** | Distinct implemented G1–G4 layouts (D11); ≥ 4 change-type widgets rendering from validated specs; live re-plan < 8s. | D9–D12 acceptance criteria met; widget-spec validation rejects unsafe free-form. |

## Instrumentation summary

| Source | Owns | Examples |
|--------|------|----------|
| **PostHog** | Product engagement, funnels, LLM cost, feedback votes | `plan_created`, `node_run`, `delegation_merged`, cost per tier, thumbs-up rate |
| **OpenTelemetry** | Latency, parallel-vs-sequential timing, end-to-end spans | time-to-first-plan, re-plan latency, critical-path runtime |
| **Eval harness (CI)** | Correctness gates on golden repos | FIR, dependency precision/recall, grounding/hallucination, drift-caught |

## To-do list

- [ ] Finalize the golden-repo eval set and label its ground-truth DAGs (precision/recall/FIR denominators).
- [ ] Wire the PostHog events listed in the instrumentation table; confirm cost events carry the tier tag.
- [ ] Stand up the FIR computation in the eval harness (parallel-execute → worktree-diff for true overlap) and gate CI on it.
- [ ] Add OTel spans for sequential-vs-parallel runtime so speedup (b) is auto-computed.
- [ ] Build the per-tier cost dashboard and the repo-context cache-hit panel.
- [ ] Set the design-partner survey for review-time-saved and analysis usefulness.
- [ ] Confirm the north-star metric is computable from the above and add it as the top dashboard tile.
- [ ] Re-validate every target after the first dogfood cohort; promote any *(stretch)* that proves achievable.

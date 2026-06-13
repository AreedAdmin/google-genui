# Milestones & Phases

> Status: **Canonical.** Sequences deliverables **D1–D17** into milestones across **Phase A (internal/dogfood) → Phase B (design-partner customer-facing) → Phase C (platform)**, front-loading the crux (the dependency engine, D4) and a thin vertical slice to de-risk early.

This roadmap is the execution spine. It maps every deliverable in [`../00-overview/deliverables.md`](../00-overview/deliverables.md) to a milestone, names the demo-able outcome, and fixes exit criteria against the acceptance criteria (AC) there. The phasing follows [`../00-overview/scope.md` §6](../00-overview/scope.md). Architecture references: [`../01-architecture/high-level-architecture.md`](../01-architecture/high-level-architecture.md), [`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md), [`../01-architecture/data-model.md`](../01-architecture/data-model.md). The crux: [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md).

---

## 0. Sequencing principles (why the order is the order)

1. **De-risk the crux first, not last.** D4 (the dependency-inference engine) is the make-or-break subsystem ([`../02-agent-system/dependency-inference-engine.md` §1](../02-agent-system/dependency-inference-engine.md)). If branch independence is wrong, the whole product loses trust. We therefore build a **thin vertical slice** through D1→D3→D4→D5→D6 *before* widening the UI surface, so the False-Independence Rate (FIR) is measurable on a real repo by the end of the second milestone.
2. **The eval harness (D15) is not a finale — it is a tool.** A minimal golden-repo harness lands alongside D4 so every later change to the engine is gated by FIR. See [`testing-and-eval.md`](./testing-and-eval.md).
3. **Asymmetric value of granularities.** G2 (Meso) is the sweet spot ([`README.md`](../README.md) granularity table). The vertical slice targets **G2** so we exercise multi-node DAGs, contracts, and 1–3 parallel branches without the ceremony of G3/G4 or the triviality of G1.
4. **Durable-vs-ephemeral split from day one.** Supabase = truth, Redis = control plane (ADR-2). Wiring both early avoids a late re-platforming.
5. **Phase gates are trust gates.** Phase A → B is crossed only when FIR and parallel-merge-clean rate clear their targets on internal repos (the customer-facing safety bar in [`../00-overview/scope.md` §6](../00-overview/scope.md)).
6. **Grounding before generation (ADR-4).** Analysis/dependency claims are derived against the analysis service's real symbol graph before any generative UI is layered on top, so the UI never renders ungrounded structure.

---

## 1. Phase → milestone → deliverable map

| Phase | Milestone | Lands deliverables | Granularity exercised |
|-------|-----------|--------------------|-----------------------|
| **A — Internal / dogfood** | **M0** Foundations & contracts | D2 (partial), D16 (partial) | — |
| | **M1** Index & plan a repo | D1, D3 | G2 |
| | **M2** The crux: grounded dependencies | **D4**, D5 (partial), **D15 (v0)** | G2 |
| | **M3** Thin vertical slice — run one branch | D6, D7 (partial), D9 (v0), D10 (v0) | G2 |
| | **M4** Generative UI core | D5 (full), D10, D11, widget set | G1 + G2 |
| **B — Design-partner customer-facing** | **M5** Real-time, iteration & drift | D8, D12 | G2 + G3 |
| | **M6** Parallel at scale + integration | D6 (full), D7 (full), D11 (G3/G4) | G3 + G4 |
| | **M7** Collaboration & delegation | D13, D14 | G2–G4 |
| | **M8** Hardening & customer safety bar | D2 (full RLS), D16 (full), D15 (full) | all |
| **C — Platform** | **M9** Platform surface & embeddability | platform-ization of D13/D14, D11 | all |
| | **M10** End-to-end demo | **D17** | **G1·G2·G3·G4** |

> A deliverable can appear in two milestones ("partial" then "full"): the first lands a vertical-slice-grade version; the second hardens it to full AC. This is deliberate — it keeps the slice thin and the crux early.

---

## Phase A — Internal / dogfood

*Goal of the phase: prove the dependency engine and conflict-free parallelism on real repositories we control, at the lowest trust/safety bar. No external users.*

### M0 — Foundations & contracts
- **Goal.** Stand up the monorepo, the durable/ephemeral split, and the cross-language contract pipeline so all later work has rails.
- **Deliverables landed.** D2 (schema + Supabase Auth + base RLS; org/project/user/role tables), D16 (partial: local + preview deploy of web/api/workers/analysis/Redis/Supabase; OTel + PostHog wiring stubbed).
- **Demo-able outcome.** `pnpm dev` brings up web + api + workers + Python analysis service + Redis + local Supabase; a smoke test round-trips a typed entity through **shared JSON Schema → zod (TS) → pydantic (Py)** and back. A trace spans web→api→worker→analysis in the OTel viewer.
- **Exit criteria.**
  - Monorepo per [`repo-structure.md`](./repo-structure.md) builds, typechecks, lints clean.
  - Core tables from [`../01-architecture/data-model.md` §2](../01-architecture/data-model.md) migrated; RLS default-deny on (D2/AC1, partial AC2).
  - One shared schema (the `touch_set` shape, [`../01-architecture/data-model.md` §5](../01-architecture/data-model.md)) codegen's to both zod and pydantic; a contract test asserts round-trip equality (seeds D15).
  - BullMQ queues (`plan-build`, `node-run`, `analysis`, `integration`, `replan`) created with a no-op worker that drains them.
- **Dependencies.** None (root milestone).
- **Sizing.** Small–Medium. **Team shape:** 1 platform/infra eng + 0.5 backend.
- **Critical path?** Yes — everything downstream depends on the contract pipeline and the queue/lock substrate.

### M1 — Index & plan a repo
- **Goal.** Onboard a real repo, index it, and produce a schema-valid set of Nodes with predicted touch-sets at G2.
- **Deliverables landed.** **D1** (repo onboarding & static index), **D3** (planner agent).
- **Demo-able outcome.** Connect an internal TS/JS repo via GitHub OAuth → analysis service emits symbol/import/call graphs → ask "add an OAuth login route" → Planner returns 4–15 Nodes, each with `change_type`, summary, and a schema-forced predicted touch-set, granularity auto-detected as `g2_meso`.
- **Exit criteria.**
  - D1: clone to managed storage; symbol + import + file↔symbol graph for TS/JS; cached in Redis keyed `{project, commit_sha}`, persisted to Storage; warm-cache fetch < 2s (D1/AC1–AC4).
  - D3: tool-forced JSON Nodes, schema-validated with retry-on-invalid; granularity detected and node count within tier bounds or re-tiered with a visible reason (D3/AC1–AC3).
  - Analysis-service endpoints `index_repo`, `symbol-graph` live and contract-tested ([`../02-agent-system/dependency-inference-engine.md` §7](../02-agent-system/dependency-inference-engine.md)).
- **Dependencies.** M0 (contracts, queues, storage).
- **Sizing.** Medium. **Team shape:** 1 Python/analysis eng (tree-sitter, networkx) + 1 agent eng (planner) + 0.5 backend.
- **Critical path?** Yes — D4 cannot start without resolved touch-sets from D1 and Nodes from D3.

### M2 — The crux: grounded dependencies *(de-risk milestone)*
- **Goal.** Derive **grounded, evidence-backed, user-ratifiable** Edges and Branches, with false-independence detection, and **measure FIR** on a golden repo. This is the highest-stakes milestone in the program.
- **Deliverables landed.** **D4** (dependency-inference engine), D5 (partial: grounded refs plumbed through, full annotation in M4), **D15 v0** (minimal eval harness).
- **Demo-able outcome.** On the M1 plan, the engine resolves predicted touch-sets to real symbols, expands the blast radius (callers, signature call-sites, type refs), derives Edges with cited evidence, partitions Branches with `overlap_score` and `independent` booleans, and **flags any false-independence with the conflicting symbol/file named**. A CLI prints FIR / precision / recall against the golden labels.
- **Exit criteria.**
  - D4/AC1–AC4: edges derived from touch-set overlap + import/call graph + data-flow; branch partition with `overlap_score` and `independent`; false-independence detection cites the conflicting symbol; every claim carries evidence and is override-able.
  - Engine implements **asymmetric caution** ([`../02-agent-system/dependency-inference-engine.md` §4.2](../02-agent-system/dependency-inference-engine.md)): uncertainty → assert dependency.
  - **D15 v0:** ≥3 hand-labeled golden repos (incl. ≥3 adversarial cases: hidden shared config, transitive type change, same-file disjoint edits); FIR / precision / recall / parallel-correctness computed in CI; **FIR gate wired even if not yet at target** (D4/AC5, D15/AC1).
  - Analysis endpoints `resolve-touchset`, `overlap`, `callgraph-impact` live and contract-tested.
- **Dependencies.** M1 (Nodes + index). Hard gate: M2 must clear before M3 parallel execution is trusted.
- **Sizing.** **Large** (the crux). **Team shape:** 2 strongest eng on the engine (1 Node/edge-derivation + 1 Python/blast-radius) + 1 eng on the eval harness + golden-repo labeling.
- **Critical path?** **Yes — this is the program's critical path.** Slipping M2 slips everything; over-investing here is correct.

### M3 — Thin vertical slice: run one branch
- **Goal.** Close the loop end-to-end on the spine ([`../00-overview/scope.md` §2](../00-overview/scope.md)): onboard → plan a G2 feature → grounded analysis → **run one node on an isolated worktree** → diff streams back. This is the "thin vertical slice" the whole plan is sequenced around.
- **Deliverables landed.** D6 (single-node/branch run on isolated worktree + locks + streamed diff), D7 (partial: integration-node stub + test gate), D9 (v0 canvas), D10 (v0 inspector).
- **Demo-able outcome.** From a connected repo: plan a G2 feature, open a node to read grounded analysis, click **Run** on one node → a git worktree is created → Sonnet build loop runs → diff + logs stream live into the UI → run records status/tokens/cost. Run a second, *independent* node in parallel; `lock:file` blocks any accidental overlap with a visible reason.
- **Exit criteria.**
  - D6/AC1–AC4: single node, branch, and multi-select run on **isolated git worktrees**; distributed locks prevent double-dispatch; cross-branch file overlap blocked/serialized with a reason; diffs + logs stream (Redis stream → client); each run records status/diff/tokens/cost.
  - D7/AC1 (partial): a branch join creates an Integration node and runs the test gate (conflict UI deferred to M6).
  - D9 v0: interactive DAG (pan/zoom/select) on React Flow; D10 v0: inspector opens a node with the five section scaffolds + Run button (full content in M4).
  - The slice runs **without manual DB pokes** — API endpoints drive it end-to-end.
- **Dependencies.** M2 (only ratified/high-confidence-independent branches may be dispatched — runtime `lock:file` backstop from [`../02-agent-system/dependency-inference-engine.md` §4.3](../02-agent-system/dependency-inference-engine.md)).
- **Sizing.** **Large.** **Team shape:** 1 builder/worktree eng + 1 backend (runs/locks/streams) + 1 frontend (canvas + inspector v0).
- **Critical path?** Yes — proves the parallel-exec safety net the product's economic value rests on.

> **End of M3 = the de-risk gate.** At this point the four pillars are proven thin-but-real on G2: P1 (DAG + branches), P2 (grounded analysis plumbing), P3 (parallel run + lock backstop), P4 (a real canvas). The riskiest 80% of technical difficulty is now behind us.

### M4 — Generative UI core
- **Goal.** Make the analysis trustworthy and the UI genuinely *generative* — per-granularity layouts and per-change-type widgets.
- **Deliverables landed.** D5 (full grounded analysis & annotation), D10 (full five-section inspector), **D11** (context-adaptive layouts — the assessment centerpiece), the ≥4 change-type widgets.
- **Demo-able outcome.** Every node inspector shows **Changes · Assumptions · Analysis · Benefits · Notable variables**, each claim cited to a real symbol or labeled `low-confidence`. A G1 plan renders **diff-first** (DAG collapsed to a checklist); a G2 plan renders a **compact DAG**. A `migration` node shows a schema-diff widget; an `api_contract` node shows a contract table; a `ui_component` node a component preview; a refactor node a call-graph-impact widget. Thumbs-up/down works.
- **Exit criteria.**
  - D5/AC1–AC3: four sections per node; every claim grounded or `low-confidence`; hallucination rate below threshold on eval ([`testing-and-eval.md`](./testing-and-eval.md)); thumbs-up/down suppresses down-voted patterns.
  - D10/AC1–AC2: five sections + action buttons (Run / Share / Delegate subtree / Add context), section content is the grounded D5 analysis with citations linking to code.
  - D11/AC1–AC3: distinct implemented layouts for **G1 and G2** (G3/G4 in M6); ≥4 change-type widgets rendering from **validated specs against the component registry** (no raw model HTML, ADR-5); layout selection generated from `(granularity × change_type × context)`.
- **Dependencies.** M3 (canvas/inspector v0), M2 (grounded refs).
- **Sizing.** **Large.** **Team shape:** 2 frontend (layouts + widgets + registry) + 1 agent eng (analysis/annotation) + design support.
- **Critical path?** Partially — D11 is the assessed centerpiece; G1/G2 here, G3/G4 can trail into M6.

---

## Phase B — Design-partner customer-facing

*Goal of the phase: a small set of external teams use Trellis. Adds hardened auth, sandboxing, the customer-facing safety bar, real-time collaboration, parallelism at scale, and delegation. Entry gate: Phase A FIR + parallel-merge-clean rate at target on internal repos.*

### M5 — Real-time, iteration & drift
- **Goal.** Make the plan a live, collaborative, re-flowing artifact.
- **Deliverables landed.** D8 (replan & drift), D12 (real-time collaborative UI).
- **Demo-able outcome.** Two users open the same plan, see presence and live node/edge/run updates. One adds context in the iteration panel → plan re-flows in < ~8s as a new revision, diffable against the prior. A build whose actual diff touches a file outside its predicted touch-set triggers drift re-derivation, and the UI shows the drift notice.
- **Exit criteria.**
  - D8/AC1–AC2: add-context re-plans in < ~8s (G2) as a new revision (diffable); drift re-derives affected edges/branches and surfaces a notice (re-runs engine Stages 3–6 on affected nodes, [`../02-agent-system/dependency-inference-engine.md` §4.4](../02-agent-system/dependency-inference-engine.md)).
  - D12/AC1–AC2: multi-user live node/edge/run + presence (Supabase Realtime + Redis pub/sub); optimistic UI with server reconciliation.
- **Dependencies.** M4 (canvas + analysis), M2 (incremental re-derivation).
- **Sizing.** Medium–Large. **Team shape:** 1 frontend (realtime/optimistic) + 1 agent eng (replan/drift) + 0.5 backend.
- **Critical path?** No, but blocks the customer demo feel.

### M6 — Parallel at scale + integration
- **Goal.** Trustworthy parallel dispatch of many branches with real merge/conflict adjudication, and the G3/G4 layouts that make large plans navigable.
- **Deliverables landed.** D6 (full multi-branch parallel), D7 (full integration/merge with conflict UI), D11 (G3 swimlanes + G4 zoomable map).
- **Demo-able outcome.** A G3 subsystem refactor renders as swimlanes; multiple independent branches dispatch in parallel; an Integration node merges them and runs the test gate; an injected conflict surfaces a resolution UI the user adjudicates — **nothing auto-merges on red tests**. A G4 plan renders as a zoomable hierarchical map with clustered super-nodes. Parallel **speedup vs sequential** is measured and reported.
- **Exit criteria.**
  - D7/AC1–AC2: Integration node attempts merge + test gate; conflicts surfaced with resolution UI; no auto-merge on red.
  - D6 hardened: many concurrent branches, `lock:file` backstop holding under load.
  - D11/AC1 completed for **G3 (swimlanes) and G4 (zoomable map)**; G4 super-nodes expand into G3/G2 sub-DAGs.
  - Eval reports **parallel speedup** and **parallel-merge-clean rate** on G3 plans ([`testing-and-eval.md`](./testing-and-eval.md)).
- **Dependencies.** M3 (run/locks), M4 (layouts G1/G2), M2 (branch correctness).
- **Sizing.** **Large.** **Team shape:** 1 builder/orchestration eng + 1 frontend (swimlane/zoomable layouts) + 1 backend (integration/merge).
- **Critical path?** Yes for economic-value story (parallel speedup, D6/D7).

### M7 — Collaboration & delegation
- **Goal.** Make work portable across people and agents.
- **Deliverables landed.** D13 (sharing & permissions), D14 (subtree delegation).
- **Demo-able outcome.** Share a plan as viewer/runner/editor (RLS-enforced). Select a subtree → export a **self-contained portable spec** (nodes, edges, touch-sets, analysis, base commit) → a recipient opens it as a runnable mini-plan, builds/edits, and merges results back.
- **Exit criteria.**
  - D13/AC1: share as viewer/runner/editor, enforced by RLS ([`../01-architecture/data-model.md` §4](../01-architecture/data-model.md)).
  - D14/AC1–AC2: subtree → portable spec (self-contained); recipient opens as runnable mini-plan, can build/edit, merge back (Flow D, [`../01-architecture/high-level-architecture.md` §3](../01-architecture/high-level-architecture.md)).
- **Dependencies.** M5 (collab UI), M6 (integration/merge for merge-back), D2 RLS.
- **Sizing.** Medium. **Team shape:** 1 backend (sharing/RLS/spec serialization) + 1 frontend (delegation UI).
- **Critical path?** No — but D14 is an originality differentiator and is required for D17.

### M8 — Hardening & customer safety bar
- **Goal.** Raise everything to the customer-facing trust/safety bar.
- **Deliverables landed.** D2 (full RLS + share grants), D16 (full observability + cost dashboards), D15 (full eval harness with all adversarial cases + CI gates).
- **Demo-able outcome.** RLS proven by a multi-tenant isolation test suite; sandboxed worktree execution with resource/network limits; OTel traces + PostHog product/LLM-cost dashboards live; the full eval harness gates merges on FIR and parallel-merge-clean.
- **Exit criteria.**
  - D2/AC2–AC3 full: RLS enforces org isolation + per-resource share grants; full revision history on all domain entities.
  - D16/AC1: reproducible deploy of web + workers + analysis + Redis + Supabase; tracing/metrics/logs; cost dashboards.
  - D15/AC1 full: all adversarial cases (hidden shared config, transitive type changes, same-file disjoint edits, migration ordering, dynamic dispatch); CI gates block merge on FIR regression ([`testing-and-eval.md`](./testing-and-eval.md)).
  - Sandboxing per [`../01-architecture/high-level-architecture.md`](../01-architecture/high-level-architecture.md) (resource/network-limited executor).
- **Dependencies.** All prior Phase-A/B milestones (hardens them).
- **Sizing.** Large. **Team shape:** 1 security/infra + 1 eval eng + 0.5 across teams for hardening.
- **Critical path?** Yes for the Phase B → C gate.

---

## Phase C — Platform

*Goal of the phase: the plan-graph + delegation become an embeddable, reusable surface.*

### M9 — Platform surface & embeddability
- **Goal.** Turn the plan-graph and delegation primitives into a reusable/embeddable surface.
- **Deliverables landed.** Platform-ization of D13/D14 (programmatic share/delegate API, portable-spec import/export as a public contract), D11 generalization (layout/widget registry as a versioned package).
- **Demo-able outcome.** A third surface (e.g. an embedded plan-graph in another tool) consumes a Trellis plan via API + the published component registry, runs and delegates a subtree without the full app.
- **Exit criteria.** Public, versioned portable-spec contract; component/widget registry published from `packages/ui`; programmatic delegation API with RLS-scoped tokens.
- **Dependencies.** M7 (delegation), M8 (security bar).
- **Sizing.** Large. **Team shape:** 1 platform eng + 1 frontend (registry packaging) + 0.5 backend.
- **Critical path?** No (post-MVP).

### M10 — End-to-end demo (D17)
- **Goal.** The scripted, clean, end-to-end demonstration across **all four granularities**.
- **Deliverables landed.** **D17** (demo deliverable).
- **Demo-able outcome (the D17 script).** A single recorded run that walks: **G1** micro fix (diff-first) → **G2** feature plan with grounded analysis → **parallel dispatch of two independent branches** → **Integration** node merge + test gate → **subtree delegation** to another user/agent → **real-time re-plan** after added context → **G3** swimlane refactor → **G4** zoomable map. Every granularity layout, ≥4 change-type widgets, and the FIR/speedup eval numbers are shown.
- **Exit criteria.**
  - D17/AC1: scripted end-to-end demo across **all four granularities** showing plan → grounded analysis → parallel dispatch of two independent branches → integration → subtree delegation → real-time re-plan.
  - **Program definition of done** ([`../00-overview/deliverables.md`](../00-overview/deliverables.md)): all of D1–D16 meet AC; D17 runs clean; eval gates (D15) green; no open **P0** items in [`../06-appendix/open-questions.md`](../06-appendix/open-questions.md).
- **Dependencies.** Effectively all of D1–D16.
- **Sizing.** Medium (integration + scripting, not new systems). **Team shape:** whole team for demo hardening; 1 owner for the script.
- **Critical path?** Yes — it is the terminal node.

---

## 2. Critical-path call-out

```
M0 ──▶ M1 ──▶ M2 (D4, the crux) ──▶ M3 (vertical slice) ──▶ M4 (D11 G1/G2)
                    │                                            │
                    └── D15 v0 (FIR gate seeded) ────────────────┘
                                                                 ▼
                                            M6 (parallel@scale, D6/D7, D11 G3/G4)
                                                                 ▼
                                            M8 (safety bar, D15 full) ──▶ M10 (D17)
```

- **The single longest pole is M2 → M3.** D4 must be correct (FIR near-zero) before parallel execution in M3 can be trusted, and parallel execution is the product's economic core. Protect this path: staff it with the strongest engineers and resist pulling them onto UI polish.
- **D15 is a parallel track, not a tail.** Its v0 lands *with* M2 so the engine is gated from birth; it only *completes* in M8.
- **D11 (the assessed centerpiece) is split** G1/G2 in M4 (on-critical-path-adjacent) and G3/G4 in M6, so the demo-able UI lands early without blocking on large-plan layout work.
- **Phase gate A→B** = FIR + parallel-merge-clean rate at target on internal repos. **Phase gate B→C** = customer safety bar (M8) cleared.

## 3. Recommended team shape (overall)

| Track | Owns | Peak milestones |
|-------|------|-----------------|
| **Dependency engine / analysis** (2 eng: 1 TS, 1 Python) | D1, D4, D8 drift, analysis-service | M1, M2, M5 |
| **Agents** (1–2 eng) | D3, D5, builder/replan agents | M2, M4, M5 |
| **Orchestration / backend** (1–2 eng) | D2, D6, D7, runs/locks/streams, RLS, D13/D14 | M3, M6, M7, M8 |
| **Generative UI / frontend** (2 eng + design) | D9, D10, D11, D12 | M3, M4, M6 |
| **Quality / platform** (1 eng, shared) | D15 harness, D16 deploy/observability, CI gates | M2, M8 |

A team of **~5–7 engineers** sustains this; the dependency-engine track is the one to never under-staff.

## 4. Sizing legend (relative, not calendar)

`Small` ≈ a few focused workstreams · `Medium` ≈ one milestone for a small squad · `Large` ≈ the heaviest milestones (M2, M3, M4, M6, M8). No calendar dates are promised here; sequencing and dependencies are the contract, durations are estimated during planning per milestone.

---

## To-do list

### Roadmap setup
- [ ] Ratify this milestone map with leads; confirm M2 (D4) is the protected critical path.
- [ ] Confirm the Phase A→B gate metric targets against [`testing-and-eval.md`](./testing-and-eval.md) (FIR, parallel-merge-clean rate).
- [ ] Confirm Phase B→C gate = M8 customer safety bar cleared.

### Phase A — internal/dogfood
- [ ] **M0** — monorepo + contracts + queues/locks + base RLS (D2 partial, D16 partial).
- [ ] **M1** — repo onboarding + static index + planner (D1, D3) at G2.
- [ ] **M2** — dependency-inference engine + false-independence detection + eval v0 (D4, D5 partial, D15 v0) — **critical path**.
- [ ] **M3** — thin vertical slice: run one node/branch on isolated worktree, streamed diff (D6, D7 partial, D9 v0, D10 v0).
- [ ] **M4** — generative UI core: grounded analysis, five-section inspector, G1/G2 layouts, ≥4 widgets (D5 full, D10, D11 partial).

### Phase B — design-partner customer-facing
- [ ] **M5** — real-time collab + iteration + drift re-derivation (D8, D12).
- [ ] **M6** — parallel-at-scale + integration/merge UI + G3/G4 layouts; report speedup (D6 full, D7 full, D11 G3/G4).
- [ ] **M7** — sharing/permissions + subtree delegation (D13, D14).
- [ ] **M8** — hardening: full RLS, sandboxing, observability/cost dashboards, full eval + CI gates (D2 full, D16 full, D15 full).

### Phase C — platform
- [ ] **M9** — platform/embeddable plan-graph + delegation API + published registry.
- [ ] **M10** — **D17** end-to-end demo across G1·G2·G3·G4; program definition-of-done check (all AC, gates green, no P0 open questions).

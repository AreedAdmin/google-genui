# Deliverables & Acceptance Criteria

> Status: **Canonical.** Each deliverable has an ID, an owner area, and explicit acceptance criteria. The final section maps deliverables to the four assessment criteria (originality, economic value, technical difficulty, generative UI).

## Legend
Each deliverable: **ID** · title · area · **Acceptance criteria (AC)** = the testable bar for "done".

---

## A. Foundation & platform

### D1 — Repo onboarding & static index
*Area: `01-architecture`, `02-agent-system` (Python service).*
- **AC1** Connect a GitHub repo (OAuth) or upload a zip; clone to managed storage.
- **AC2** Produce a **symbol graph** (functions/classes/types/exports), **import graph**, and **file↔symbol map** for TS/JS.
- **AC3** Index is cached in Redis keyed by `{project, commit_sha}` and persisted to Supabase Storage; re-index is incremental on new commits.
- **AC4** Index available to agents via the analysis-service API in < 2s for a warm cache.

### D2 — Multi-tenant data & auth
*Area: `01-architecture/data-model.md`, `security-and-auth.md`.*
- **AC1** Orgs, projects, users, roles; Supabase Auth.
- **AC2** Row-Level Security enforces org isolation and per-resource share grants.
- **AC3** All domain entities (plans, nodes, edges, branches, runs, delegations) persisted with full revision history.

---

## B. The agent system (the core)

### D3 — Planner agent (P1)
*Area: `02-agent-system/planner-agent.md`.*
- **AC1** Given a prompt + repo index + detected granularity, emit a set of **Nodes** each with: title, `change_type`, summary, and a **predicted touch-set** (files/symbols to add/modify).
- **AC2** Granularity (G1–G4) is detected and attached; node count respects tier bounds (or the plan is re-tiered with a visible reason).
- **AC3** Deterministic schema-validated output (tool-forced JSON); retries on invalid.

### D4 — Dependency-Inference Engine (P1, **the crux**)
*Area: `02-agent-system/dependency-inference-engine.md`.*
- **AC1** Derive **Edges** between nodes from touch-set overlap + import/call graph + data-flow.
- **AC2** Partition nodes into **Branches**; compute an `overlap_score` and a boolean `independent` per branch pair.
- **AC3** **False-independence detection:** any two "independent" branches that share a file, a mutated symbol, a changed signature, or a schema/config key are flagged with the conflicting symbol cited.
- **AC4** Each independence/dependency claim carries **evidence** (the symbols/files) rendered in the UI; the user can override (ratification).
- **AC5** Measured dependency accuracy on the eval set meets the target in `success-metrics.md`.

### D5 — Grounded analysis & annotation (P2)
*Area: `02-agent-system/analysis-annotation-agent.md`.*
- **AC1** Per node, produce four sections: **Assumptions**, **Analysis** (risks: race conditions, failure modes, edge cases), **Benefits**, **Notable variables & objects**.
- **AC2** Every claim cites a real symbol/file or is labeled `low-confidence`; hallucination rate below threshold on eval.
- **AC3** User can thumbs-up/down any claim; down-voted patterns are suppressed.

### D6 — Builder agent & parallel execution (P3)
*Area: `02-agent-system/builder-agent.md`, `parallel-orchestration.md`.*
- **AC1** Run a single node, a branch, or a multi-select; each branch executes on an **isolated git worktree**.
- **AC2** Distributed locks prevent double-dispatch; file-overlap across concurrently running branches is blocked or serialized with a visible reason.
- **AC3** Diffs and logs **stream** to the UI in real time (Redis stream → client).
- **AC4** Each run records status, diff artifact, tokens, cost.

### D7 — Integration / merge (P3)
*Area: `02-agent-system/integration-merge.md`.*
- **AC1** Branch joins create an **Integration node**; the agent attempts the merge and runs the test gate.
- **AC2** Conflicts are surfaced with a resolution UI; the user adjudicates; nothing auto-merges on red tests.

### D8 — Replan & drift handling
*Area: `02-agent-system/replan-and-drift.md`.*
- **AC1** Adding context re-plans in < ~8s (G2) and produces a **new revision** (diffable against prior).
- **AC2** When a build discovers a new dependency, the affected edges/branches re-derive and the UI reflects the drift with a notice.

---

## C. Generative UI (the assessed surface)

### D9 — Graph canvas (P4)
*Area: `03-generative-ui/graph-canvas.md`.*
- **AC1** Interactive DAG (pan/zoom/select/multi-select) on React Flow; nodes colored by status & change-type; edges typed (`depends_on`/`data_flow`/`sequence`).
- **AC2** Independent branches are visually distinct; parallel-dispatchable selections highlighted.

### D10 — Node inspector with five sections (P2/P4)
*Area: `03-generative-ui/node-inspector.md`.*
- **AC1** Opening a node shows **Changes · Assumptions · Analysis · Benefits · Notable variables**, plus action buttons (**Run**, **Share**, **Delegate subtree**, **Add context**).
- **AC2** Section content is the grounded analysis from D5, with citations linking to code.

### D11 — Context-adaptive layouts (P4, **assessment centerpiece**)
*Area: `03-generative-ui/granularity-layouts.md`.*
- **AC1** Distinct, implemented layouts for **G1, G2, G3, G4** (diff-first → compact DAG → swimlanes → zoomable map).
- **AC2** A node's inner content renders the right **change-type widget** for ≥4 change types (schema-diff, API-contract, component-preview, call-graph-impact).
- **AC3** Layout selection is generated from `(granularity × change_type × context)` and validated against a component registry (no unsafe free-form HTML).

### D12 — Real-time collaborative UI
*Area: `03-generative-ui/realtime-ui.md`, `collaboration-ui.md`.*
- **AC1** Multiple users see live node/edge/run updates and presence (Supabase Realtime + Redis pub/sub).
- **AC2** Optimistic UI on user edits; server reconciles.

---

## D. Collaboration & delegation (P3)

### D13 — Sharing & permissions
*Area: `04-collaboration-delegation/sharing-model.md`.*
- **AC1** Share a plan as **viewer / runner / editor**; enforced by RLS.

### D14 — Subtree delegation
*Area: `04-collaboration-delegation/subtree-delegation.md`.*
- **AC1** Select a subtree → export a **portable spec** (self-contained: nodes, edges, touch-sets, analysis, base commit).
- **AC2** Recipient opens the spec as a runnable mini-plan and can build or edit it; results can be merged back.

---

## E. Cross-cutting

### D15 — Eval harness & quality gates
*Area: `05-implementation/testing-and-eval.md`.*
- **AC1** Golden-repo eval measuring dependency accuracy, false-independence rate, analysis grounding, and parallel speedup; runs in CI.

### D16 — Deployment & observability
*Area: `01-architecture/deployment-and-infra.md`.*
- **AC1** Reproducible deploy of web + workers + analysis service + Redis + Supabase; tracing/metrics/logs; cost dashboards.

### D17 — Demo deliverable
*Area: `05-implementation`.*
- **AC1** A scripted end-to-end demo across **all four granularities**, showing: plan → grounded analysis → parallel dispatch of two independent branches → integration → subtree delegation → real-time re-plan.

---

## Mapping to the four assessment criteria

| Criterion | Carried primarily by | Why it scores |
|-----------|----------------------|---------------|
| **Originality** | D4 (parallelizable change-DAG), D11 (context-adaptive layouts), D14 (subtree delegation) | The combination — a *ratifiable dependency graph* + *generated per-context UI* + *subtree handoff* — is whitespace; competitors ship linear plans. |
| **Economic value** | D6/D7 (parallel speedup), D13/D14 (delegation), D5 (review-time saved) | Parallelizes the most expensive labor a software org has and makes work portable across people/agents. |
| **Technical difficulty** | D4 (dependency engine), D6/D7 (conflict-free parallel exec + merge), D8 (drift) | Grounded dependency inference + conflict-free worktree orchestration + live re-derivation is genuinely hard. |
| **Generative UI** | D9, D10, D11, D12 | The interface *is* the product; layouts and node widgets are generated for the specific work, not templated once. |

## Definition of done (program-level)
All of D1–D16 meet AC; D17 demo runs clean end-to-end; eval gates (D15) green; `06-appendix/open-questions.md` has no open **P0** items.

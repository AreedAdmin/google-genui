# Project Scope

> Status: **Canonical.** Defines exactly what Trellis is, the boundaries of the build, and the granularity model the whole product adapts to.

## 1. Problem statement

Engineers and the agents that assist them plan in their heads and execute linearly. Today's coding agents (GitHub Copilot Workspace, Cursor agent, Devin, Claude Code) produce a **linear** plan and then build. There is no shared, operable artifact that:

1. Shows the **dependency structure** of a change and which parts are **independent** (and therefore parallelizable),
2. Carries **grounded engineering analysis** (assumptions, risks, benefits, key symbols) per unit of work,
3. Lets a team **fan work out to multiple agents or people** without conflicts, and
4. Adapts its **presentation** to the size and *kind* of work being done.

Trellis is that artifact: a generative, interactive **plan graph** that is simultaneously a planning tool, a parallel execution console, and a delegation primitive.

## 2. Core user journey (the spine of the product)

1. **Describe** — User connects a repo and states intent at any granularity ("add OAuth login", "extract the billing module into a service", "scaffold this project").
2. **Plan** — The **Planner** decomposes the request into Nodes; the **Dependency-Inference Engine** grounds each Node in real symbols and derives Edges, marking independent **Branches**.
3. **Inspect** — User opens any Node to see: *Changes*, *Assumptions*, *Analysis (risks/race conditions/failure modes)*, *Benefits*, *Notable variables & objects*, and change-type-specific generated widgets.
4. **Iterate** — User adds context in an iteration panel; the plan re-flows in real time (nodes/edges update, independence re-derived).
5. **Operate** — User clicks **Run** on a Node, a Branch, or a selection; agents execute on isolated worktrees; diffs stream back; **Integration** nodes reconverge branches.
6. **Delegate** — User exports a subtree as a portable spec and shares it (read-only plan, runnable plan, or full handoff) with another user or agent.

## 3. Granularity model (drives layout, parallelism, depth)

| Tier | Detection signal | Layout posture | Parallelism | Analysis depth |
|------|------------------|----------------|-------------|----------------|
| **G1 Micro** (1–3 nodes) | Single symbol/file; verbs like "fix/rename/tighten" | **Diff-first**: collapse DAG to a vertical checklist; inspector opens to the diff | Rarely needed | Focused: assumptions + the one or two real risks |
| **G2 Meso** (4–15 nodes) | One feature/route/flow; touches a handful of files | **Compact DAG**: left-to-right, contracts & test plan emphasized | 1–3 branches | Per-node full card |
| **G3 Macro** (15–50 nodes) | Subsystem refactor / new service; cross-module | **Swimlane DAG**: lanes by component; integration nodes explicit | Many branches; conflict guard prominent | Full + cross-node interaction analysis |
| **G4 Mega** (50+ nodes) | Greenfield / large migration | **Zoomable map**: clustered super-nodes expand into sub-DAGs; milestone lanes | Heavy fan-out; delegation primary | Per-cluster + milestone-level |

> The tier is a **default**, not a cage. The user can promote/demote a plan's tier; super-nodes (G4) expand into G3/G2 sub-DAGs. See `03-generative-ui/granularity-layouts.md`.

Beyond size, **change type** adapts the node's *content* (a migration shows a schema diff; an API change shows a contract table; a UI change shows a component preview). Layout = `f(granularity × change_type × context)`.

## 4. In scope (MVP — "v1, demo-ready, production-grade")

- **Repo onboarding** for one language family first (TypeScript/JS), Python second. Connect via GitHub OAuth or upload.
- **Static repo index** (symbol graph, import graph, file↔symbol map) via the Python analysis service.
- **Planner agent** → Nodes + summaries at any of G1–G4.
- **Dependency-Inference Engine** → grounded Edges, Branches, `overlap_score`, **false-independence detection**, user-ratifiable.
- **Grounded analysis** per node (P2) with symbol citations and a confidence signal.
- **Generative UI**: graph canvas (React Flow), node inspector with the five sections, **per-granularity layouts (G1–G4)**, and **≥4 change-type widgets** (schema-diff, API-contract, component-preview, call-graph-impact).
- **Real-time iteration** panel with live re-plan.
- **Parallel execution**: run a node/branch/selection; per-branch git worktrees; conflict detection; streamed diffs & logs; **integration node** for merge.
- **Delegation**: export a subtree → portable spec; share a plan with role-based permission (viewer/runner/editor).
- **Multi-tenant**: orgs, projects, auth, RLS, presence.
- **Eval harness** for plan correctness & dependency accuracy (see `05-implementation/testing-and-eval.md`).

## 5. Explicitly out of scope (v1)

- Full autonomous "build the whole project unattended" with no human ratification (we always show a ratifiable plan first).
- Languages beyond TS/JS + Python (architecture is language-pluggable; more land later).
- A general IDE / editor surface (we link to diffs and PRs; we are not replacing the editor).
- On-prem / air-gapped deployment (cloud SaaS first).
- A marketplace for delegated tasks / payments (delegation ships as sharing, not a labor market).
- Mobile-native apps (responsive web only).

## 6. Audience & phasing (answer to "both")

The user base is **both internal and customer-facing**, phased to avoid building two products at once:

- **Phase A — Internal/dogfood:** our own engineers, integrations we control, lower trust/safety bar. Validates the dependency engine and parallelism on real repos.
- **Phase B — Design-partner customer-facing:** a small set of external teams; adds hardened auth, sandboxing, billing hooks, and the customer-facing safety bar.
- **Phase C — Platform:** the plan-graph + delegation become an embeddable/reusable surface.

See `05-implementation/milestones-and-phases.md` for the mapping to milestones.

## 7. Non-goals / guardrails (honesty constraints baked into scope)

- **We never present an independence claim as a guarantee.** Branches show *why* they're independent (touch-sets) and flag overlap risk; the user ratifies.
- **Every analysis claim is grounded** in cited symbols/files or it is labeled low-confidence.
- **Granularity range is bounded by value:** G1 stays lightweight (no forced DAG ceremony); G4 stays navigable (no 500-node wall). The engine refuses to pretend a fine-grained change has a meaningful DAG.

## 8. Constraints & assumptions

- Target repos are Git repositories; execution uses ephemeral git worktrees per branch.
- Claude is the reasoning engine; the system is model-pluggable but tuned for Opus 4.8 (plan/analysis) + Sonnet 4.6 (build).
- Latency budget: first-plan render < ~30s for G2; incremental re-plan < ~8s.
- The plan is **append-and-revise**, fully versioned (every re-plan is a new revision; nothing is silently overwritten).

## 9. Success definition (summary; full in `success-metrics.md`)

- **Dependency accuracy:** ≥ X% of branches marked independent are truly conflict-free on execution (target set in `success-metrics.md`).
- **Parallel speedup:** measurable wall-clock reduction vs sequential on G3 plans.
- **Trust:** analysis cards rated useful (thumbs-up rate) above threshold; low hallucination rate.
- **Assessment criteria:** strong on originality, economic value, technical difficulty, and generative-UI depth (`deliverables.md`).

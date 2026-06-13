# Trellis — Generative-UI Agentic Coding Planner

> **Codename:** Trellis — *a frame that trains parallel growth along independent paths.*
> **One line:** You describe what you want built (a function, a route, an architecture, or a whole project); Trellis's agents produce an **interactive dependency graph of the changes**, annotated with grounded assumptions/risks/benefits, that you can **dispatch in parallel**, **iterate on in real time**, and **delegate by subtree** to other people or agents.

This directory is the **complete, rigorous project plan**. It is the source of truth for scope, architecture, and the work breakdown. Every document is canonical unless marked `DRAFT` or listed in `06-appendix/open-questions.md`.

---

## The thesis

> **The agent's output is software, not an answer.** Trellis does not return a chat reply or a single diff — it returns a *plan you can operate*: a generative, interactive control surface over a unit of engineering work.

The product is **not a UI project**. It is a **dependency-reasoning and parallel-orchestration project with an excellent generative UI on top**. The graph, cards, and buttons are the demo; *correct, trustworthy dependency inference that makes conflict-free parallelism real* is the product. See `02-agent-system/dependency-inference-engine.md` — that engine is the make-or-break.

---

## The four pillars

| # | Pillar | What it means | Primary docs |
|---|--------|---------------|--------------|
| **P1** | **Plan Graph (the DAG)** | Decompose a request into a dependency graph of changes; identify *independent* branches that can run in parallel. | `02-agent-system/dependency-inference-engine.md`, `02-agent-system/planner-agent.md` |
| **P2** | **Grounded Analysis** | Per-node *assumptions*, *risk analysis* (race conditions, failure modes), *benefits*, and *notable variables/objects* — each grounded in real symbols, not hallucinated. | `02-agent-system/analysis-annotation-agent.md` |
| **P3** | **Parallel Execution & Delegation** | Dispatch agents per branch on isolated git worktrees with conflict detection; or export a subtree as a portable spec and hand it to another user/agent. | `02-agent-system/parallel-orchestration.md`, `04-collaboration-delegation/subtree-delegation.md` |
| **P4** | **Context-Adaptive Generative UI** | Layouts *and* per-node widgets are generated for the specific **granularity × change-type × context** of the work; the plan can be iterated in real time. | `03-generative-ui/granularity-layouts.md`, `03-generative-ui/widget-generation.md` |

These pillars map directly to the four assessment criteria — see `00-overview/deliverables.md`.

---

## The granularity model (referenced everywhere)

Trellis adapts to **four granularity tiers**. The tier is detected from the request + repo and drives the layout, the parallelism emphasis, and the analysis depth.

| Tier | Name | Typical request | Node count | Layout posture |
|------|------|-----------------|-----------|----------------|
| **G1** | **Micro** | "Fix this function / add a param / tighten this validation" | 1–3 | Diff-first; DAG collapses to a checklist |
| **G2** | **Meso** | "Add this API route / this UI flow / this feature" | 4–15 | Compact DAG; contracts + tests emphasized — **the sweet spot** |
| **G3** | **Macro** | "Refactor this subsystem / add this service" | 15–50 | Full DAG with swimlanes; parallelism + integration nodes prominent |
| **G4** | **Mega** | "Build this project / run this migration" | 50+ | Zoomable hierarchical map; clustered super-nodes; delegation front-and-center |

Full definitions and per-tier layout specs live in `00-overview/scope.md` and `03-generative-ui/granularity-layouts.md`.

---

## How this plan is organized

| Dir | Purpose | Key files |
|-----|---------|-----------|
| `00-overview/` | What we're building and why | `scope.md`, `deliverables.md`, `vision-and-positioning.md`, `personas-and-use-cases.md`, `success-metrics.md`, `risks-and-mitigations.md` |
| `01-architecture/` | How the system is built | `high-level-architecture.md`, `tech-stack.md`, `data-model.md`, `api-design.md`, **`integration-surfaces.md`**, `realtime-and-state.md`, `security-and-auth.md`, `deployment-and-infra.md` |
| `02-agent-system/` | The agents and the dependency engine | `overview.md`, **`dependency-inference-engine.md`**, `planner-agent.md`, `analysis-annotation-agent.md`, `builder-agent.md`, **`agent-runners.md`**, `parallel-orchestration.md`, `integration-merge.md`, `replan-and-drift.md`, `prompts-and-tools.md` |
| `03-generative-ui/` | The generative, context-adaptive UI | `genui-philosophy.md`, `graph-canvas.md`, `node-inspector.md`, **`granularity-layouts.md`**, `widget-generation.md`, `component-library.md`, `realtime-ui.md`, `collaboration-ui.md` |
| `04-collaboration-delegation/` | Sharing & handoff | `sharing-model.md`, `subtree-delegation.md`, `multi-user-sync.md` |
| `05-implementation/` | Roadmap & execution | `milestones-and-phases.md`, `repo-structure.md`, `todo-master.md`, `testing-and-eval.md`, **`demo-script.md`** |
| `06-appendix/` | Reference | `glossary.md`, `competitive-landscape.md`, `open-questions.md` |

### Suggested reading order
1. `00-overview/scope.md` → `00-overview/deliverables.md`
2. `01-architecture/high-level-architecture.md` → `tech-stack.md` → `data-model.md`
3. `02-agent-system/dependency-inference-engine.md` (the crux) → `02-agent-system/overview.md`
4. `03-generative-ui/granularity-layouts.md` (the genUI centerpiece)
5. `05-implementation/milestones-and-phases.md` → `todo-master.md`

---

## Canonical decisions (do not contradict)

- **Product name:** Trellis. **Unit of work entity:** a *Plan*. **Atom:** a *Node* (one coherent change). **Link:** an *Edge* (a dependency). **Lane:** a *Branch* (a set of nodes runnable in isolation).
- **Stack:** Next.js/TypeScript app · Node orchestration workers · **Python** dependency-analysis service · **Supabase** (Postgres + Auth + Realtime + Storage) · **Redis** (queue + cache + locks + pub/sub) · **Claude** (Opus 4.8 for planning/analysis, Sonnet 4.6 for high-volume build). Rationale in `01-architecture/tech-stack.md`.
- **Mandated agent/UI integrations:** **CopilotKit** (headless / `useCoAgent`, **canvas-primary — not chat-first**) · **AG-UI** (agent↔user transport, emitted from our **bespoke** agent loop — no agent framework) · **A2A** (agent↔agent: pluggable runner + subtree delegation; does **not** replace BullMQ) · **Linkup** (external web-grounding tool, labelled distinctly from repo-symbol grounding). Additive layers — **no pillar changes**. See [`01-architecture/mandated-integrations.md`](./01-architecture/mandated-integrations.md).
- **Granularity tiers:** G1 Micro / G2 Meso / G3 Macro / G4 Mega (above).
- **Change types** (drive widgets): `migration`, `api_contract`, `ui_component`, `logic`, `refactor`, `bugfix`, `config`, `infra`, `test`, `docs`.
- **The DAG is a *ratified hypothesis*, not a guarantee** — independence claims are shown with evidence and are user-correctable.
- **Execution is a pluggable, user-selectable *runner*** — Trellis orchestrates; the chosen agentic coding tool (with repo access) does the coding inside isolated worktrees. **v1/demo runner = Claude Code (headless).** Orchestration owns all safety (worktree isolation, drift audit, test gate, integration) regardless of runner. See `02-agent-system/agent-runners.md`.
- **Invocation is web-app-first** — the generative-UI canvas is home; an **MCP server + `/trellis <prompt>` slash command** launches a plan from inside a coding agent and deep-links to the canvas. See `01-architecture/integration-surfaces.md`.

## Status legend
`TODO` not started · `WIP` in progress · `DONE` complete · `BLOCKED` waiting · `DRAFT` proposed, not canonical.

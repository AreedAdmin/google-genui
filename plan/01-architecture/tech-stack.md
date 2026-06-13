# Tech Stack & Rationale

> Status: **Canonical.** Locks in the technology choices the rest of the plan depends on. The user mandated **Supabase, Redis, Claude, and JS or Python**; this doc explains the exact roles and why the split is the way it is. A **second mandate** adds **CopilotKit, AG-UI, A2A, and Linkup** — new rows in the table below; full roles/decisions in [mandated-integrations.md](./mandated-integrations.md).

## TL;DR

| Layer | Technology | Language | Why |
|-------|-----------|----------|-----|
| Web app + collaborative canvas | **Next.js (App Router) + React + React Flow** | TypeScript | Realtime collaborative graph UI; Supabase-native client; Vercel-friendly; the genUI surface lives where the components live. |
| Orchestration API + agent workers | **Node service (Fastify) + BullMQ workers** | TypeScript | Single runtime for the agent loop, git/worktree manipulation, and the Anthropic SDK; shares types with the web app. |
| Dependency-analysis service | **FastAPI microservice** | **Python** | tree-sitter + `networkx` + graph algorithms are cleanest in Python; isolates CPU-heavy parsing behind a typed API. **This is where Python clearly wins.** |
| Durable data, auth, realtime, storage | **Supabase** (Postgres + Auth + Realtime + Storage) | — | One platform for relational data, multi-tenant RLS, realtime change feeds, and artifact storage. |
| Queue, cache, locks, pub/sub | **Redis** | — | Task broker (BullMQ), result/index cache, distributed locks for conflict-free parallelism, low-latency streams for logs/tokens/presence. |
| Reasoning | **Claude** (Opus 4.8 + Sonnet 4.6) | — | Opus for planning/analysis (deep reasoning); Sonnet for high-volume build steps; prompt caching for repo context. |
| Agent ↔ user (genUI transport) | **AG-UI + CopilotKit** (headless) | TypeScript | Streams agent state to the React Flow canvas via `useCoAgent`/`useCopilotAction`; **canvas-primary, not a chatbox**. AG-UI events emitted from the bespoke loop. See [mandated-integrations.md §3.1, §5, §6](./mandated-integrations.md). |
| Agent ↔ agent | **A2A** (`@a2a-js/sdk`) | TypeScript | Pluggable runner boundary + subtree delegation, in the Node layer; complements (does **not** replace) BullMQ. See [mandated-integrations.md §3.2](./mandated-integrations.md). |
| External grounding | **Linkup** | — | Web-search tool in the agent tool-use loop; evidence labelled `web:linkup` vs `repo-symbol`. See [mandated-integrations.md §3.3](./mandated-integrations.md). |

**Why hybrid TS + Python and not one language:** the agent loop, worktree I/O, and realtime all want to live in the same Node runtime as the app (shared types, one deploy story). The *one* concern that is materially better in Python — multi-language static analysis (tree-sitter bindings, graph libraries, AST tooling) — is isolated as a stateless microservice with a clean contract. This gives a principled "both", not an accidental polyglot mess.

---

## 1. Frontend / Generative-UI surface

- **Next.js (App Router), React, TypeScript** — SSR for shell, client components for the live canvas.
- **React Flow (xyflow)** — the DAG canvas: nodes, typed edges, pan/zoom, multi-select, custom node renderers per change-type. Supports the G1–G4 layouts and semantic zoom (super-nodes).
- **Layout engines:** `dagre` / `elk.js` for automatic DAG layout; custom swimlane layout for G3; hierarchical clustering for G4.
- **Tailwind CSS + shadcn/ui (Radix)** — design system primitives for the node inspector and widgets; consistent, accessible.
- **Zustand** — client graph/UI state (selection, layout mode, optimistic updates); **TanStack Query** for server state.
- **Supabase JS client** — auth session + Realtime subscriptions to plan/node/run channels.
- **Monaco / Shiki** — code & diff rendering inside node widgets.
- **Generated widgets** (schema-diff, API-contract table, component-preview, call-graph-impact) render from **validated specs** against a component registry — never raw model HTML. See `03-generative-ui/widget-generation.md`.

## 2. Orchestration API + agent workers (Node/TypeScript)

- **Fastify** HTTP API (`/plans`, `/nodes/:id/run`, `/plans/:id/replan`, `/plans/:id/delegate`, …; see `api-design.md`).
- **BullMQ on Redis** — durable job queues: `plan-build`, `node-run`, `analysis`, `integration`. Workers scale horizontally.
- **Anthropic TypeScript SDK** — planner, analysis, builder, replan agents; tool-use loop; **prompt caching** of the repo index/context block.
- **`isomorphic-git` / native `git`** + ephemeral **git worktrees** — one worktree per branch for conflict-free parallel builds.
- **Sandboxed execution** — builds run in a constrained container (resource/network limits) before diffs are surfaced; see `security-and-auth.md`.
- **zod** — schema validation of all agent tool outputs (Nodes, Edges, annotations, widget specs).

## 3. Dependency-analysis service (Python / FastAPI)

- **FastAPI + pydantic** — typed endpoints: `index_repo`, `symbol_graph`, `predict_touchset_resolution`, `overlap`, `callgraph_impact`.
- **tree-sitter** (TS/JS grammar first, Python second) — parse to ASTs; extract symbols, imports, references.
- **`networkx`** — import graph, call graph, and the change DAG algorithms (reachability, overlap, cycle detection).
- **Stateless + cached** — results cached in Redis keyed by `{project, commit}`; no DB of its own. Horizontally scalable.
- **Why isolated:** keeps heavy parsing off the Node event loop, makes language support pluggable (add a grammar = add a language), and gives the dependency engine a testable, deterministic core. Detail in `02-agent-system/dependency-inference-engine.md`.

## 4. Supabase (data plane)

- **Postgres** — all durable domain entities (`projects`, `plans`, `plan_nodes`, `plan_edges`, `branches`, `runs`, `node_annotations`, `delegations`, `shares`, `comments`, `events`). Schema in `data-model.md`.
- **Auth** — **v1: email+password or GitHub OAuth only** (GitHub also grants repo access); orgs & roles. OTP/magic-link/MFA/SSO deferred to Phase B (see [security-and-auth.md §1](./security-and-auth.md)).
- **Realtime** — Postgres change feeds drive the collaborative canvas (node/edge/run updates, presence).
- **Storage** — diffs, build logs, exported subtree specs, indexed-symbol artifacts.
- **RLS** — org isolation + per-resource share grants (viewer/runner/editor). See `security-and-auth.md`.

## 5. Redis (control plane)

| Use | Mechanism | Example key |
|-----|-----------|-------------|
| Job queue | BullMQ | `queue:node-run` |
| Index / touch-set cache | String/Hash + TTL | `cache:symbolgraph:{project}:{commit}` |
| Distributed locks (no double-dispatch, file-overlap guard) | `SET NX PX` / Redlock | `lock:branch:{id}`, `lock:file:{project}:{path}` |
| Log/token streaming | Redis Streams | `stream:run:{id}` |
| Presence | Pub/Sub + TTL keys | `presence:plan:{id}` |
| Rate limiting / cost guards | Token bucket | `ratelimit:org:{id}` |

Supabase Realtime carries **durable** state changes; Redis carries **ephemeral, high-frequency** signal (streaming logs, presence, locks). This division keeps the DB write load sane.

## 6. Claude (reasoning)

| Agent | Model | Why |
|-------|-------|-----|
| Planner (decompose → nodes) | **Opus 4.8** | Deep decomposition + granularity judgment. |
| Dependency reasoning (grounded edge derivation, false-independence) | **Opus 4.8** | Highest-stakes correctness; reasons over analysis-service evidence. |
| Analysis/annotation (assumptions/risks/benefits/symbols) | **Opus 4.8** | Trust-critical; must be grounded. |
| Builder (code generation per node) | **Sonnet 4.6** | High-volume, cost-sensitive; tool-use build loop. |
| Replan / drift | **Opus 4.8** for structure, **Sonnet 4.6** for incremental edits | Balance latency & cost. |
| Widget-spec generation | **Sonnet 4.6** | Produces validated layout/widget specs, not prose. |

- **Prompt caching** for the repo-context block (symbol summaries, conventions) cuts cost/latency across all calls on a plan.
- **Tool use** is the execution substrate: agents call analysis-service endpoints, file read/write, test runners, and git — all schema-validated.
- **Model-pluggable** behind an internal interface, but tuned and evaluated against the above defaults.

## 7. Supporting tooling

- **Monorepo:** pnpm workspaces (`apps/web`, `apps/api`, `apps/workers`, `packages/shared`, `services/analysis` [Python]). Layout in `05-implementation/repo-structure.md`.
- **Validation/contracts:** zod (TS) + pydantic (Py); shared JSON Schemas for cross-language entities (Node/Edge/Annotation/WidgetSpec).
- **Observability:** OpenTelemetry traces across web→api→workers→analysis; PostHog for product analytics + LLM cost; structured logs.
- **CI/CD:** typecheck, lint, unit, the eval harness (`05-implementation/testing-and-eval.md`), preview deploys.
- **Infra:** containers for api/workers/analysis; managed Redis; Supabase managed; web on Vercel or container. Detail in `deployment-and-infra.md`.

## 8. Rejected / deferred alternatives (honesty)

- **TS-only (drop Python):** viable with node tree-sitter bindings, but graph/AST ergonomics and future multi-language support are weaker; we keep Python for the one concern that benefits most.
- **Temporal for orchestration:** powerful but heavy for v1; BullMQ + explicit state in Postgres is enough and simpler to operate. Revisit at platform scale.
- **A bespoke realtime server (Yjs/CRDT) for the canvas:** deferred — Supabase Realtime + optimistic UI covers v1; CRDT only if true concurrent graph co-editing becomes a hard requirement (`06-appendix/open-questions.md`).
- **LangChain/LangGraph:** not adopted — the agent graph is small and bespoke; direct SDK + our own orchestration is clearer and easier to evaluate. **(Upheld under the second mandate:** the AG-UI requirement is honored by emitting AG-UI events from the bespoke loop, **without** adopting a framework — see [mandated-integrations.md §5](./mandated-integrations.md).)

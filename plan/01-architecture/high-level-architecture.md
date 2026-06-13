# High-Level Architecture

> Status: **Canonical.** System overview, component responsibilities, the core data/control flows, and diagrams. Stack rationale is in `tech-stack.md`; schema in `data-model.md`.

## 1. System diagram

```
                                  ┌──────────────────────────────────────────────┐
                                  │                  CLIENT (browser)             │
                                  │  Next.js / React / TypeScript                 │
                                  │                                               │
                                  │  ┌──────────────┐   ┌──────────────────────┐  │
                                  │  │ Graph Canvas │   │ Node Inspector +     │  │
                                  │  │ (React Flow) │   │ Generated Widgets    │  │
                                  │  │ G1..G4 layts │   │ (schema-diff,        │  │
                                  │  └──────────────┘   │  api-contract, ...)  │  │
                                  │  ┌──────────────┐   └──────────────────────┘  │
                                  │  │ Iteration /  │   Zustand + TanStack Query   │
                                  │  │ Context panel│   Supabase Realtime sub      │
                                  │  └──────────────┘                              │
                                  └───────┬───────────────────────┬───────────────┘
                            HTTPS (REST)  │                        │  WS (Realtime + Redis stream relay)
                                          ▼                        ▼
        ┌─────────────────────────────────────────────┐   ┌──────────────────────────────┐
        │      ORCHESTRATION API  (Node / Fastify)     │   │   Supabase Realtime           │
        │  /plans /nodes/:id/run /replan /delegate ... │   │  (Postgres change feeds →     │
        │  authz · validation (zod) · enqueues jobs    │   │   live node/edge/run/presence)│
        └───────┬───────────────────────────┬──────────┘   └──────────────────────────────┘
                │ enqueue (BullMQ)           │ read/write
                ▼                            ▼
   ┌──────────────────────────┐    ┌──────────────────────────────────────────────┐
   │   REDIS (control plane)  │    │            SUPABASE (data plane)              │
   │  queues · locks · cache  │◄───┤  Postgres (plans/nodes/edges/branches/runs/  │
   │  streams · presence      │    │  annotations/delegations/shares/events)      │
   └───────┬──────────────────┘    │  Auth · Realtime · Storage (diffs/logs/specs)│
           │ dequeue               └──────────────────────────────────────────────┘
           ▼
   ┌───────────────────────────────────────────────────────────────────────────────┐
   │                         AGENT WORKERS (Node / TypeScript)                       │
   │                                                                                 │
   │  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  ┌──────────┐  ┌──────────┐  │
   │  │ Planner  │→ │ Dependency   │→ │ Analysis /    │  │ Builder  │  │ Replan / │  │
   │  │ (Opus)   │  │ Inference    │  │ Annotation    │  │ (Sonnet) │  │ Drift    │  │
   │  │          │  │ (Opus+svc)   │  │ (Opus)        │  │ worktree │  │ (Opus)   │  │
   │  └──────────┘  └──────┬───────┘  └───────────────┘  └────┬─────┘  └──────────┘  │
   │                       │ calls                            │ git worktree exec     │
   └───────────────────────┼─────────────────────────────────┼───────────────────────┘
                           │ HTTP                             │
                           ▼                                  ▼
        ┌──────────────────────────────────┐    ┌──────────────────────────────────┐
        │ DEPENDENCY-ANALYSIS SVC (Python)  │    │  SANDBOXED WORKTREE EXECUTOR      │
        │ tree-sitter · networkx            │    │  ephemeral git worktree / branch  │
        │ symbol/import/call graph          │    │  resource+network limited         │
        │ touch-set resolution · overlap    │    │  runs tests, produces diffs       │
        └──────────────────────────────────┘    └──────────────────────────────────┘
                           ▲                                  ▲
                           └──────────────┬───────────────────┘
                                          ▼
                                   ┌───────────────┐
                                   │  CLAUDE API   │  Opus 4.8 (plan/dep/analysis)
                                   │               │  Sonnet 4.6 (build/widgets)
                                   └───────────────┘
```

## 2. Component responsibilities

| Component | Responsibility | Does NOT |
|-----------|----------------|----------|
| **Web app** | Render graph + inspector + widgets; capture intent/context; optimistic UI; subscribe to realtime. | Hold business logic or talk to Claude directly. |
| **Orchestration API** | AuthZ, validation, persistence, enqueue jobs, expose REST. | Run long agent loops inline (that's workers). |
| **Agent workers** | Planner / dependency / analysis / builder / replan loops; call Claude + analysis service; manage worktrees. | Render UI; own durable schema. |
| **Dependency-Analysis service** | Parse repos; build symbol/import/call graphs; resolve predicted touch-sets to real symbols; compute overlap. | Make product decisions; persist state. |
| **Worktree executor** | Run a node's build in an isolated, sandboxed git worktree; emit diffs/logs/test results. | Decide what to build (builder agent decides). |
| **Supabase** | Durable state, auth, RLS, realtime feeds, artifact storage. | Ephemeral high-frequency signal (that's Redis). |
| **Redis** | Queues, locks, cache, log/token streams, presence. | Long-term truth. |
| **Claude** | Reasoning for plan/dependency/analysis/build/replan. | Direct DB/file access (always via tools). |

## 3. Core flows (sequence)

### Flow A — Create a plan
```
User intent ──▶ API POST /plans (prompt, repo, granularity?)
  API: persist Plan(draft) ─▶ enqueue plan-build
  Worker(Planner): detect granularity ─▶ Claude(Opus) ─▶ Nodes[] + predicted touch-sets
  Worker ─▶ Analysis svc: resolve touch-sets to real symbols; build import/call slices
  Worker(Dependency): derive Edges, partition Branches, overlap_score, false-independence flags
  Worker: persist Nodes/Edges/Branches  ──▶ Supabase
  Supabase Realtime ──▶ Client renders DAG (layout = f(granularity, change_types))
  Worker(Analysis/Annotation): per-node assumptions/risks/benefits/symbols (async, streamed in)
```

### Flow B — Run a branch (parallel)
```
User selects Branch(s) ──▶ API POST /branches/:id/run
  API: acquire lock:branch ─▶ enqueue node-run per node (respecting edges)
  Worker(Builder): create git worktree ─▶ Claude(Sonnet) tool-loop (read/write/test) ─▶ diff
    │ acquires lock:file per touched path → blocks cross-branch file overlap
  Redis stream:run ──▶ client live logs/diff
  On branch complete ─▶ Integration node enqueued ─▶ merge attempt + test gate
  Conflicts ─▶ surfaced to user for adjudication (no auto-merge on red)
```

### Flow C — Iterate / re-plan
```
User adds context ──▶ API POST /plans/:id/replan
  Worker(Replan): diff intent ─▶ Claude(Opus) ─▶ revised Nodes/Edges (new revision)
  Dependency re-derivation on changed touch-sets only (incremental)
  Realtime ──▶ canvas re-flows; revision is diffable vs prior
```

### Flow D — Delegate a subtree
```
User selects subtree ──▶ API POST /plans/:id/delegate (root node, role)
  API: serialize portable spec (nodes/edges/touch-sets/analysis/base commit) ─▶ Storage
  Create delegation + share grant (RLS)
  Recipient opens spec as a runnable mini-plan ─▶ build/edit ─▶ optional merge-back
```

## 4. Key architectural decisions (ADR-style summary)

- **ADR-1: Plan is a ratified hypothesis.** The DAG is computed, shown with evidence, and user-correctable before execution. Architecture never auto-runs an unratified plan in customer-facing mode.
- **ADR-2: Durable vs ephemeral split.** Supabase = truth + realtime durable changes; Redis = locks/queues/streams/presence. Prevents DB write storms from log streaming.
- **ADR-3: Worktree-per-branch isolation.** Parallel safety comes from physical isolation (separate worktrees) + file-level distributed locks, not from hoping the LLM avoids conflicts.
- **ADR-4: Grounding before generation.** Analysis and dependency claims are derived against the analysis-service's real symbol graph; the LLM annotates evidence, it does not invent structure.
- **ADR-5: Generated UI is validated, not raw.** The model emits *widget/layout specs* validated against a component registry; the client never renders arbitrary model HTML (security + consistency).
- **ADR-6: Everything is versioned.** Plans, nodes, edges, runs are append-and-revise; re-plans create revisions, never silent overwrites.

## 5. Scaling & failure posture (summary; detail in `deployment-and-infra.md`)

- Workers scale per queue; analysis service scales statelessly behind cache.
- Locks have TTLs; a dead worker's lock expires and its node is re-queued (idempotent runs keyed by `run_id`).
- Claude calls are retried with backoff; tool outputs are schema-validated with bounded repair retries.
- A plan in `executing` survives worker restarts because run state lives in Postgres/Redis, not worker memory.

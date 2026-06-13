# Glossary

> Status: **Canonical.** The authoritative definition of every Trellis term, entity, and key technical concept. Alphabetical; each entry 1–3 lines with a link to the doc that defines it. When a term is used elsewhere in the plan, it means exactly what it means here.

---

### Activity feed
The chronological, human-readable projection of a Plan's `events` (edits, runs, shares, delegations, comments), rendered live. See [`../04-collaboration-delegation/multi-user-sync.md`](../04-collaboration-delegation/multi-user-sync.md#6-activity-feed).

### Analysis (node section)
The P2 grounded engineering analysis of a Node's risks — race conditions, failure modes, edge cases, perf, security — each with a `severity`, `confidence`, and grounded symbol refs. One of the five inspector sections. See [`../02-agent-system/analysis-annotation-agent.md`](../02-agent-system/analysis-annotation-agent.md).

### Analysis-annotation agent
The Opus-4.8 agent (P2) that produces a Node's Assumptions, Analysis, Benefits, and Notable symbols, every claim grounded in cited symbols/files or labeled low-confidence. See [`../02-agent-system/analysis-annotation-agent.md`](../02-agent-system/analysis-annotation-agent.md).

### Analysis service
The stateless Python/FastAPI microservice that parses repos (tree-sitter), builds symbol/import/call/type graphs (networkx), and answers `resolve-touchset` / `overlap` / `callgraph-impact`. See [`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md#3-dependency-analysis-service-python--fastapi).

### Assumptions (node section)
The P2 list of assumptions a Node's plan rests on, each grounded in real symbols/files. One of the five inspector sections. See [`../02-agent-system/analysis-annotation-agent.md`](../02-agent-system/analysis-annotation-agent.md).

### Base commit (`base_commit`)
The exact Git commit a Plan (or a delegation's portable spec) is reasoned against; every touch-set and analysis claim is valid only relative to it. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#plans).

### Benefits (node section)
The P2 list of benefits/value a Node delivers, grounded where possible. One of the five inspector sections. See [`../02-agent-system/analysis-annotation-agent.md`](../02-agent-system/analysis-annotation-agent.md).

### Blast radius
The full set of symbols/files truly affected by a Node's change after the analysis service expands a predicted touch-set (callers, signature call-sites, type refs, schema/config consumers). Drives edge derivation. See [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md#stage-3--resolve-touch-sets-to-real-symbols-analysis-service).

### Branch
A set of Nodes runnable in isolation (a parallelizable lane); a weakly-connected, overlap-free slice of the hard-edge subgraph. Carries `independent_of[]`. Entity: `branches`. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#branches-parallelizable-lanes) and [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md#stage-6--build-dag--branches).

### Builder agent
The Sonnet-4.6 agent (P3) that generates the code for a Node, running its tool-use build loop on an isolated git worktree. See [`../02-agent-system/builder-agent.md`](../02-agent-system/builder-agent.md).

### Change type (`change_type`)
The kind of a Node's change — `migration | api_contract | ui_component | logic | refactor | bugfix | config | infra | test | docs` — which selects the change-type widget. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#1-enums).

### Confidence
A 0..1 signal attached to resolutions, edges, and analysis claims; low confidence forces caution (soft-order over hard independence, "low-confidence" labels). See [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md#stage-5--classify-independence--conflict-this-is-the-safety-core).

### Delegation
A handoff of a Plan subtree to another user or agent as a portable spec, tracked through `delegation_status`. Entity: `delegations`. See [`../04-collaboration-delegation/subtree-delegation.md`](../04-collaboration-delegation/subtree-delegation.md).

### Dependency-Inference Engine
The crux subsystem (P1) that resolves predicted touch-sets to real symbols, derives Edges, scores overlap, detects false independence, and partitions Branches — all grounded and user-ratifiable. See [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md).

### Drift
Divergence between a Node's *predicted* touch-set and the *actual* files a build (or a returned delegation) touches; triggers re-derivation of affected edges/branches. See [`../02-agent-system/replan-and-drift.md`](../02-agent-system/replan-and-drift.md).

### Edge
A typed dependency link between two Nodes (`depends_on | data_flow | sequence | soft_order`), carrying `evidence` and an `overlap_score`. Entity: `plan_edges`. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#plan_edges).

### Evidence
The symbols/files justifying an Edge (or an independence claim), rendered in the UI so dependency/independence is never asserted without grounding. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#5-key-json-shapes).

### Events
The append-only audit + realtime-fan-out table; the source of the activity feed and the sharing/delegation audit trail. Entity: `events`. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#events-audit--realtime-fan-out).

### External guest
A share/delegation principal outside the resource's org; capped at the org's `max_external_role` (default `runner`) and badged. See [`../04-collaboration-delegation/sharing-model.md`](../04-collaboration-delegation/sharing-model.md#3-who-you-can-share-with-principals).

### False independence
The dangerous case where two Branches the planner wanted parallel actually conflict (shared file, mutated symbol, changed signature, schema/config key). Detected aggressively and flagged with the conflicting symbol cited. Measured by FIR. See [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md#stage-5--classify-independence--conflict-this-is-the-safety-core).

### FIR (False-Independence Rate)
The fraction of "independent" Branch pairs that actually conflict on execution — the **primary safety metric**, targeted near-zero. See [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md#8-evaluation-how-we-know-it-works--gates-in-testing-and-evalmd) and [`../05-implementation/testing-and-eval.md`](../05-implementation/testing-and-eval.md).

### Granularity tiers (G1–G4)
The four sizes Trellis adapts to: **G1 Micro** (1–3 nodes, diff-first), **G2 Meso** (4–15, compact DAG, the sweet spot), **G3 Macro** (15–50, swimlanes), **G4 Mega** (50+, zoomable clustered map, delegation-primary). Enum: `granularity`. See [`../00-overview/scope.md`](../00-overview/scope.md#3-granularity-model-drives-layout-parallelism-depth).

### Integration contract
The portion of a portable spec that declares what a delegated subtree **requires** from the parent and **provides** back (symbols/signatures/schema) — the verifiable definition of done for merge-back. See [`../04-collaboration-delegation/subtree-delegation.md`](../04-collaboration-delegation/subtree-delegation.md#3-the-portable-spec-format).

### Integration node
A Node inserted where Branches reconverge; the merge agent attempts the merge and runs the test gate, surfacing conflicts for adjudication (nothing auto-merges on red). Entity: `integration_nodes`. See [`../02-agent-system/integration-merge.md`](../02-agent-system/integration-merge.md).

### LayoutSpec
The validated specification of which generated layout to render for a Plan, selected from `(granularity × change_type × context)` and checked against the component registry — never free-form HTML. See [`../03-generative-ui/granularity-layouts.md`](../03-generative-ui/granularity-layouts.md).

### Node
The atom of a Plan: one coherent change, with a `change_type`, summary, predicted+resolved touch-set, annotations, and status. Entity: `plan_nodes`. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#plan_nodes).

### Node inspector
The panel that opens a Node to its five sections (Changes · Assumptions · Analysis · Benefits · Notable variables) plus action buttons (Run, Share, Delegate subtree, Add context). See [`../03-generative-ui/node-inspector.md`](../03-generative-ui/node-inspector.md).

### Notable variables & objects (node section)
The P2 list of the key symbols/objects a Node centers on, with `role` and `why_notable`. One of the five inspector sections. See [`../02-agent-system/analysis-annotation-agent.md`](../02-agent-system/analysis-annotation-agent.md).

### Optimistic UI / reconciliation
The edit model: apply an edit locally instantly, send to the server, then confirm or roll back against the authoritative DB row fanned out over Realtime. See [`../04-collaboration-delegation/multi-user-sync.md`](../04-collaboration-delegation/multi-user-sync.md#3-optimistic-edits--server-reconciliation).

### Overlap score (`overlap_score`)
A 0..1 weighted measure of how much two Nodes' touch-sets collide (file, symbol, signature, schema, config); `0` ≈ safe to parallelize, `>0` ≈ conflict risk. See [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md#stage-5--classify-independence--conflict-this-is-the-safety-core).

### Plan
The unit of engineering work: a generative, interactive dependency graph of Nodes/Edges/Branches for one request, fully versioned. Entity: `plans`. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#plans).

### Plan revision
A versioned snapshot of a Plan; every re-plan writes a new `plan_revisions` row so any historical state is diffable/renderable. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#plan_revisions).

### Portable spec (portable plan)
The self-contained JSON artifact exported from a subtree — nodes, internal edges, frozen annotations, resolved touch-sets, repo ref + `base_commit`, and the integration contract — stored in the `specs` bucket. The "GitHub for plans" payload. See [`../04-collaboration-delegation/subtree-delegation.md`](../04-collaboration-delegation/subtree-delegation.md#3-the-portable-spec-format).

### Presence
Live "who is here and what they're touching" on a Plan, via `presence:plan:{id}` heartbeats; advisory, not a security boundary. See [`../04-collaboration-delegation/multi-user-sync.md`](../04-collaboration-delegation/multi-user-sync.md#2-presence).

### Project
A connected Git repository within an org; the parent of Plans and the unit `repo_index` is computed for. Entity: `projects`. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#projects).

### Ratification
The `editor`-only UI handshake by which a user confirms/adds/splits dependency claims; only ratified-or-high-confidence-independent Branches are parallel-dispatched. Treats the DAG as a ratified hypothesis. See [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md#stage-7--ratify-ui-handshake).

### Replan
A re-derivation of the Plan after added context or discovered drift; produces a new revision in < ~8s for G2. See [`../02-agent-system/replan-and-drift.md`](../02-agent-system/replan-and-drift.md).

### Repo index
The cached symbol graph, import graph, and file↔symbol map for a `{project, commit}`, produced by the analysis service and stored in the `repo-index` bucket. Entity: `repo_index`. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#repo_index).

### Run
An execution record (plan/analysis/node_build/integration/replan) with status, model, tokens, cost, and a live logs stream key; `runs.id` is the worker idempotency key. Entity: `runs`. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#runs).

### Share / `share_role`
A grant of access to a Plan or Project at `viewer | runner | editor`, enforced by RLS. Entity: `shares`. See [`../04-collaboration-delegation/sharing-model.md`](../04-collaboration-delegation/sharing-model.md).

### Super-node
A G4 cluster node that expands into a G3/G2 sub-DAG; lets a 50+-node Plan stay navigable via semantic zoom. Sub-nodes carry `parent_node_id`. See [`../03-generative-ui/granularity-layouts.md`](../03-generative-ui/granularity-layouts.md) and [`../00-overview/scope.md`](../00-overview/scope.md#3-granularity-model-drives-layout-parallelism-depth).

### Touch-set (predicted / resolved)
A Node's footprint: the **predicted** add/modify/delete from the Planner, and the **resolved** real files/symbols/signatures/schema/config keys (plus blast radius) from the analysis service. The substrate of all dependency reasoning. See [`../01-architecture/data-model.md`](../01-architecture/data-model.md#5-key-json-shapes).

### Tree-sitter
The incremental parser used by the analysis service to extract symbols/imports/references (TS/JS first, Python second). See [`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md#3-dependency-analysis-service-python--fastapi).

### WidgetSpec
A validated spec for a change-type widget (e.g. `schema_diff`, `api_contract`, `call_graph_impact`) rendered against the component registry, never raw model HTML. Stored in `node_annotations.widget_specs`. See [`../03-generative-ui/widget-generation.md`](../03-generative-ui/widget-generation.md).

### Worktree
An ephemeral, isolated git worktree per Branch, giving conflict-free parallel builds; each touched file is also guarded by `lock:file`. See [`../02-agent-system/parallel-orchestration.md`](../02-agent-system/parallel-orchestration.md).

---

### Tech-term quick reference

| Term | Meaning | Doc |
|------|---------|-----|
| **BullMQ** | Redis-backed durable job queues (`plan-build`, `node-run`, `analysis`, `integration`, `replan`). | [`tech-stack.md`](../01-architecture/tech-stack.md#5-redis-control-plane) |
| **networkx** | Python graph library for import/call/type graphs and DAG algorithms. | [`tech-stack.md`](../01-architecture/tech-stack.md#3-dependency-analysis-service-python--fastapi) |
| **React Flow (xyflow)** | The canvas library for the interactive DAG (pan/zoom/select, custom node renderers). | [`tech-stack.md`](../01-architecture/tech-stack.md#1-frontend--generative-ui-surface) |
| **Redis** | Control plane: queue, cache, distributed locks, log/presence streams. | [`tech-stack.md`](../01-architecture/tech-stack.md#5-redis-control-plane) |
| **RLS (Row-Level Security)** | Postgres-enforced org isolation + per-resource share grants; default deny. | [`security-and-auth.md`](../01-architecture/security-and-auth.md) |
| **Supabase Realtime** | Postgres change feeds that drive the collaborative canvas (durable state). | [`tech-stack.md`](../01-architecture/tech-stack.md#5-redis-control-plane) |
| **Redlock** | The distributed-lock algorithm behind `lock:branch`/`lock:node`/`lock:file`. | [`data-model.md`](../01-architecture/data-model.md#6-redis-key-schema) |
| **CRDT / Yjs** | Conflict-free replicated data types; deferred — see why in multi-user-sync. | [`multi-user-sync.md`](../04-collaboration-delegation/multi-user-sync.md#7-why-v1-is-realtime--optimistic-ui-not-crdt) |
| **zod / pydantic** | Schema validation (TS / Python) of all agent tool outputs; shared JSON Schemas across the boundary. | [`tech-stack.md`](../01-architecture/tech-stack.md#7-supporting-tooling) |
| **Opus 4.8 / Sonnet 4.6** | Claude models: Opus for plan/analysis/dependency reasoning, Sonnet for high-volume build. | [`tech-stack.md`](../01-architecture/tech-stack.md#6-claude-reasoning) |

---

## To-do list

- [ ] Keep this glossary in lockstep with `../01-architecture/data-model.md` enums and entity names (single source of truth for names).
- [ ] Add entries for any new term introduced by a new canonical doc.
- [ ] Verify every link resolves after the docs it points to are written (anchors match headings).
- [ ] Cross-check `change_type`, `granularity`, `share_role`, and `delegation_status` values against the data-model enums on each release.

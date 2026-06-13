# Personas & Use Cases

> Status: **Canonical.** Defines the people Trellis serves and the concrete end-to-end scenarios — spanning granularity tiers G1–G4 — that the product must make excellent, including parallel-dispatch and subtree-delegation journeys.

The six-step spine — **Describe → Plan → Inspect → Iterate → Operate → Delegate** — is defined in [`scope.md`](./scope.md) §2. Every scenario below is an instance of that spine. Granularity tiers (G1 Micro / G2 Meso / G3 Macro / G4 Mega) are defined in [`scope.md`](./scope.md) §3.

---

## 1. Personas

### P-A — "Maya", Staff Engineer decomposing a refactor
| | |
|---|---|
| **Goals** | Turn a large, half-formed refactor in her head into a concrete, reviewable, parallelizable plan; not lose the dependency reasoning when she context-switches. |
| **Pains** | Decomposition lives only in her head; juniors can't safely parallelize her work; "can these two land together?" is guesswork; reviews miss cross-module risks. |
| **How Trellis helps** | The Planner + dependency engine externalize the DAG; branches are proven independent with cited evidence (W1); grounded analysis (P2) surfaces cross-module race conditions she'd otherwise catch only in review. |
| **Home tier** | **G3 Macro** (occasionally G4 for whole-subsystem rewrites). |

### P-B — "Devon", Tech Lead delegating work
| | |
|---|---|
| **Goals** | Slice a feature/refactor across 3–5 engineers (and increasingly agents) so pieces progress in parallel and reconverge cleanly. |
| **Pains** | Hand-written tickets lose context; people pick overlapping work and collide at merge; status is opaque until PRs land. |
| **How Trellis helps** | Selects subtrees → exports portable specs (W3, D14); assigns by `share_role` (viewer/runner/editor); integration nodes (D7) reconverge branches; live presence + run status replace status meetings. |
| **Home tier** | **G3–G4.** |

### P-C — "Sam", Solo dev shipping a feature
| | |
|---|---|
| **Goals** | Plan and ship a feature quickly; run the independent pieces (route, UI, tests) at once instead of serially. |
| **Pains** | Linear agents make him wait for each step; he forgets edge cases; no cheap way to see what a feature actually touches. |
| **How Trellis helps** | G2 compact DAG with contracts + test plan emphasized; one-click parallel dispatch of 2–3 independent branches; grounded analysis catches the edge cases. |
| **Home tier** | **G2 Meso** (the sweet spot). |

### P-D — "Río", Agent-fleet operator
| | |
|---|---|
| **Goals** | Drive large work (migrations, greenfield scaffolds) by fanning many nodes out to many builder agents at maximum safe concurrency. |
| **Pains** | Naive fan-out corrupts merges; no global view of which agent owns which file; cost/latency explode without guardrails. |
| **How Trellis helps** | File-overlap locks (`lock:file:{project}:{path}`) and distributed dispatch locks make heavy fan-out conflict-free (P3); the G4 zoomable map shows cluster-level status; cost guards (`ratelimit:org:{id}`) cap spend. |
| **Home tier** | **G4 Mega.** |

### P-E — "Partner Team", External design-partner squad
| | |
|---|---|
| **Goals** | Use Trellis as a shared, operable planning surface across a small team on their own repo, with safe permissions. |
| **Pains** | Need org isolation, role-based sharing, and a customer-grade safety/sandbox bar before they'll run agents on their code. |
| **How Trellis helps** | Multi-tenant orgs + RLS + `shares` grants; real-time collaborative canvas (D12); sandboxed execution. Served in **Phase B** ([`scope.md`](./scope.md) §6). |
| **Home tier** | **G2–G3.** |

**Persona → tier map**

| Persona | G1 | G2 | G3 | G4 |
|---------|:--:|:--:|:--:|:--:|
| P-A Staff Eng | ○ | ○ | ● | ◐ |
| P-B Tech Lead | | ○ | ● | ● |
| P-C Solo dev | ◐ | ● | ○ | |
| P-D Fleet operator | | | ◐ | ● |
| P-E Partner team | ○ | ● | ● | ○ |

● primary · ◐ frequent · ○ occasional

---

## 2. End-to-end use-case scenarios

Each scenario follows the spine. Entities (`plan`, `plan_nodes`, `branches`, `runs`, `integration_nodes`, `delegations`) and statuses are per [`../01-architecture/data-model.md`](../01-architecture/data-model.md).

### UC-1 (G1 Micro) — "Tighten this validation" · *Sam*
- **Describe:** "The email validator on `signup` accepts `a@b`; tighten it and add a test."
- **Plan:** 2 nodes (`logic` change + `test`); engine detects **G1**, collapses the DAG to a diff-first checklist.
- **Inspect:** node inspector opens straight to the diff; Assumptions + the one real risk (existing users with now-invalid emails).
- **Iterate:** Sam adds "don't break existing rows" → analysis updates, suggests a non-blocking warning path.
- **Operate:** one Run; diff streams back; test gate green.
- **Delegate:** n/a. *Demonstrates: G1 stays lightweight — no forced DAG ceremony ([`scope.md`](./scope.md) §7).*

### UC-2 (G2 Meso) — "Add OAuth login" · *Sam* · **parallel dispatch**
- **Describe:** "Add Google OAuth login to the app."
- **Plan:** ~9 nodes across `api_contract`, `logic`, `ui_component`, `migration`, `test`; **G2** compact DAG; engine derives 3 branches.
- **Inspect:** API-contract widget on the `/auth/callback` node; schema-diff widget on the `oauth_tokens` table node.
- **Iterate:** "use PKCE" → re-plan in < ~8s, new revision, callback node updated.
- **Operate:** **Branch A (DB migration + token service)** and **Branch B (login button + redirect UI)** are proven independent (`overlap_score = 0`) → **dispatched in parallel** on two worktrees; diffs stream concurrently. Branch C (the integration test) waits on a `depends_on` edge.
- **Delegate:** n/a. *Demonstrates: the first parallel-dispatch journey.*

### UC-3 (G2 Meso) — "Add a CSV export endpoint" · *Partner Team*
- **Describe:** "Add `GET /reports/:id/export.csv`."
- **Plan:** ~6 nodes; **G2**; contracts + test plan emphasized.
- **Inspect:** API-contract widget shows request/response; analysis flags a streaming-vs-buffering risk for large reports.
- **Iterate:** "stream it, reports can be 100MB" → analysis upgrades the perf risk to high; a node for chunked encoding appears.
- **Operate:** runner-role member runs the branch; viewer-role teammate watches live (presence + streamed logs).
- **Delegate:** n/a. *Demonstrates: role-based collaboration on a shared plan (D12/D13).*

### UC-4 (G3 Macro) — "Extract billing into a service" · *Maya* · **subtree delegation**
- **Describe:** "Extract the billing module into a standalone service with its own API."
- **Plan:** ~28 nodes; **G3** swimlane DAG (lanes: `extraction`, `api`, `callers`, `data`, `infra`); integration nodes explicit.
- **Inspect:** call-graph-impact widget on the `extract-invoicing` node shows every downstream caller; cross-node interaction analysis flags a shared `BillingContext` two "independent" lanes both mutate → engine marks them **dependent with cited evidence** (false-independence *avoided*).
- **Iterate:** Maya ratifies one edge the engine was unsure of and overrides another (user correction, D4-AC4); branches re-derive.
- **Operate:** the `api` and `callers` lanes (now proven independent) dispatch in parallel; an **Integration node** reconverges them and runs the test gate.
- **Delegate:** Maya selects the entire **`data`-migration subtree**, exports a **portable spec** (`delegations`, status `sent`), and hands it to a teammate as `runner`. The teammate opens it as a runnable mini-plan, builds it, and the result merges back. *Demonstrates: the flagship subtree-delegation journey + integration.*

### UC-5 (G3 Macro) — "Add a notifications service" · *Devon* · **distributing work**
- **Describe:** "Stand up a notifications service (email + in-app) consumed by 4 existing modules."
- **Plan:** ~35 nodes; **G3**; conflict guard prominent.
- **Inspect:** Devon reviews grounded analysis on the queue-consumer node (idempotency + at-least-once delivery risks cited to real handlers).
- **Iterate:** trims scope on two nodes; plan re-flows, branch independence re-computed.
- **Operate / Delegate:** Devon slices the plan into **4 subtrees** (one per consuming module) + a core-service subtree; delegates the 4 module subtrees to 4 engineers as `editor`, keeps the core himself. Each subtree runs on its own worktree; integration nodes merge module-by-module; the file-overlap guard serializes the two subtrees that both touch `config/services.ts` with a visible reason. *Demonstrates: multi-way subtree delegation + visible serialization on overlap.*

### UC-6 (G4 Mega) — "Migrate from REST to gRPC across the monorepo" · *Río* · **heavy parallel fan-out**
- **Describe:** "Migrate all internal service-to-service calls from REST to gRPC."
- **Plan:** 80+ nodes; **G4** zoomable map; clustered super-nodes per service; milestone lanes (`proto-defs` → `servers` → `clients` → `cleanup`).
- **Inspect:** a super-node expands into a G2 sub-DAG; per-cluster analysis at the map level.
- **Iterate:** Río demotes one cluster to G3 to inspect it in detail.
- **Operate:** after `proto-defs` lands, the per-service `servers` clusters are mutually independent → Río **fans ~20 nodes out to the builder-agent fleet** at the file-overlap-guarded max concurrency; cost guard caps spend; the map fills in cluster-by-cluster.
- **Delegate:** the `cleanup` milestone subtree is exported and handed to a second operator. *Demonstrates: G4 navigability + safe heavy fan-out + cost guarding.*

### UC-7 (G4 Mega) — "Scaffold this project from a spec" · *Sam → Partner Team*
- **Describe:** upload a product spec doc; "scaffold a Next.js + Supabase app implementing this."
- **Plan:** 60+ nodes; **G4** hierarchical map; delegation front-and-center.
- **Inspect / Iterate:** Sam expands the `auth` and `billing` super-nodes, refines them at G2, leaves the rest clustered.
- **Operate:** independent foundation clusters (schema, auth, UI shell) dispatch in parallel.
- **Delegate:** the `billing` subtree is delegated to the Partner Team to own end-to-end. *Demonstrates: greenfield G4 + cross-team handoff.*

### UC-8 (G3 Macro, drift) — "Replace the cache layer" · *Maya* · **drift handling**
- **Describe:** "Swap our in-process cache for Redis everywhere."
- **Plan / Operate:** branches dispatch; mid-build, the builder discovers a previously-unmodeled call into the cache from `session.ts`.
- **Drift:** the affected edges/branches **re-derive**; the UI shows a drift notice and a new revision; a branch that *looked* independent is now flagged dependent before any corrupt merge happens (D8). *Demonstrates: live re-derivation prevents a false-independence merge — the safety story in motion.*

**Scenario → spine coverage**

| UC | Tier | Describe | Plan | Inspect | Iterate | Operate | Delegate | Highlights |
|----|:----:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| UC-1 | G1 | ● | ● | ● | ● | ● | — | diff-first, lightweight |
| UC-2 | G2 | ● | ● | ● | ● | ● | — | **parallel dispatch** |
| UC-3 | G2 | ● | ● | ● | ● | ● | — | role-based collab |
| UC-4 | G3 | ● | ● | ● | ● | ● | ● | **subtree delegation** + integration |
| UC-5 | G3 | ● | ● | ● | ● | ● | ● | multi-way delegation, serialization |
| UC-6 | G4 | ● | ● | ● | ● | ● | ● | heavy fan-out, cost guard |
| UC-7 | G4 | ● | ● | ● | ● | ● | ● | greenfield, cross-team |
| UC-8 | G3 | ● | ● | ● | ● | ● | — | **drift / false-independence avoided** |

The scripted demo (D17 in [`deliverables.md`](./deliverables.md)) is assembled from **UC-2 (parallel) + UC-4 (delegation + integration) + UC-1/UC-6 (tier range) + UC-8 (re-plan)**.

## To-do list

- [ ] Validate personas P-A…P-E against real design-partner interviews; record which tiers they actually inhabit.
- [ ] Pick the canonical demo repo(s) and confirm UC-2 and UC-4 run end-to-end on them.
- [ ] Map each UC to the eval golden-repo set in [`../05-implementation/testing-and-eval.md`](../05-implementation/testing-and-eval.md).
- [ ] Confirm UC-8 (drift) is reproducible on a fixture where a hidden dependency surfaces at build time.
- [ ] Pressure-test the G4 fan-out (UC-6) against the cost/latency budget in [`success-metrics.md`](./success-metrics.md).
- [ ] Decide whether agent-as-recipient delegation (UC-4/UC-5) ships in MVP or Phase B; reflect in [`../04-collaboration-delegation/subtree-delegation.md`](../04-collaboration-delegation/subtree-delegation.md).

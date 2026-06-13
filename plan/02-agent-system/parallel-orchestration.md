# Parallel Orchestration (running branches at once)

> Status: **Canonical.** Defines how multiple branches execute concurrently: a topological enqueue that respects hard edges, parallelization restricted to **ratified / high-confidence-independent** branches, worktree-per-branch isolation enforced by the `lock:file` discipline, concurrency caps + backpressure, and the runtime correction path when the engine's independence prediction turns out wrong.
>
> **Amended by [mandated-integrations.md](../01-architecture/mandated-integrations.md)** — dispatch to runners crosses the **A2A** boundary; **BullMQ** remains the internal queue/lock/idempotency layer — the two are distinct layers, do not collapse them. See §3.2.

This is the operational realization of **Pillar P3** (`../README.md`) and **Flow B** (`../01-architecture/high-level-architecture.md`). It composes the single-node loop from `builder-agent.md` across many lanes. The safety thesis is unchanged from `dependency-inference-engine.md §4`: parallelism is *predicted* by the engine and *guaranteed* by physical isolation + distributed locks. The engine being wrong costs lost parallelism and a visible flag — never a corrupted merge.

## 1. What is allowed to run in parallel

A branch is dispatchable in parallel **only if** it is one of:
- **Ratified independent** — the user confirmed it via the Stage-7 handshake (`dependency-inference-engine.md §7`); `branches.independent_of[]` is populated and locked.
- **High-confidence independent** — the engine asserts independence with `overlap_score ≈ 0`, no shared mutated symbol/file, and per-node `resolution_confidence ≥ τ` for every node in the branch.

Everything else runs **sequentially** under its hard-edge ordering. Asymmetric caution (`dependency-inference-engine.md §4.2`) means *when unsure, serialize*. The **"Dispatch parallel"** action (`../03-generative-ui/graph-canvas.md`) selects exactly the set of branches that are pairwise in each other's `independent_of[]` — proven-disjoint — and enqueues them together.

## 2. Enqueue strategy (topological + lane-isolated)

```
POST /branches/:id/run    (or POST /plans/:id/dispatch with a branch set)
  API: validate role=runner; acquire lock:branch:{id} per branch (no double-dispatch)
  API: for each branch, compute the node order = topo sort of the branch's internal hard edges
  API: enqueue one branch-run job onto queue:node-run per branch  → workers
  Worker(branch-run): create the branch worktree off base_commit (ADR-3)
    for node in topo_order:
      if upstream node failed → mark remaining skipped, branch_status=failed, stop
      run builder loop (builder-agent.md) in the branch worktree
    on all-built → enqueue integration job onto queue:integration (integration-merge.md)
```

- **Hard edges are inviolable.** Within a branch, nodes build in topological order in one worktree (a node's base is the branch HEAD after prior nodes commit). **Across** branches, a cross-branch hard edge means the downstream branch is *not* dispatched until the upstream branch's nodes it depends on are `built` (the dispatcher gates on this; soft `soft_order` edges do not gate).
- **One worktree per branch** (`branches.worktree_path`) — physical isolation (ADR-3). Two branches never share a working tree.
- `lock:branch:{id}` (TTL 60s, heartbeated) prevents the same branch being dispatched twice concurrently.

## 3. The distributed-lock discipline (the no-collision guarantee)

The engine *predicts* disjoint touch-sets; locks *enforce* it. Per `builder-agent.md §5`:

- Every write to path `p` in any branch first acquires `lock:file:{project}:{p}` (`../01-architecture/data-model.md §6`).
- Because each branch is in its own worktree, two branches writing **different** files never contend — they proceed fully in parallel.
- If two branches attempt the **same** file (a prediction error), exactly one holds the lock; the other **blocks → serializes** behind it with a visible reason, and emits a false-independence event (§6).

> Invariant: **at no instant do two concurrently-running branches both hold a write lock on the same path.** This holds independent of the engine's accuracy. It is the runtime backstop named in `dependency-inference-engine.md §4.3`.

## 4. Concurrency caps & backpressure

- **`max_concurrent_branches`** per plan and per org (org cap protects shared infra and Claude rate budget). The "Dispatch parallel" set is admitted up to the cap; the remainder queues.
- **BullMQ concurrency** on `queue:node-run` bounds simultaneously-running branch workers; excess jobs wait in the queue (natural backpressure).
- **`ratelimit:org:{id}` token bucket** (`../01-architecture/data-model.md §6`) gates Claude dispatch so a wide fan-out doesn't blow the cost/rate budget; when drained, new node runs wait rather than fail.
- **Lock-pressure backpressure**: if many branches are blocked on `lock:file` contention, the dispatcher stops admitting new branches from the same plan and surfaces the contention (a signal the partition is wrong → re-derive, §6).
- Worktree disk pressure: a cap on live worktrees per host; worktrees GC after merge/fail (`builder-agent.md §3`).

## 5. Worked example — two independent branches at once

Plan with branches **B1** ("add `/login` route": touches `src/routes/login.ts`, `src/auth/session.ts`) and **B2** ("add billing webhook": touches `src/routes/billing.ts`, `src/billing/webhook.ts`). The engine computed `overlap_score(B1,B2)=0`, disjoint files, and the user **ratified** both: `B1.independent_of=[B2]`, `B2.independent_of=[B1]`.

1. User clicks **Dispatch parallel** → API selects {B1, B2} (mutually in `independent_of`), acquires `lock:branch:B1` and `lock:branch:B2`, enqueues two branch-run jobs.
2. Worker-1 creates worktree `wt-B1` off `c0`; Worker-2 creates `wt-B2` off `c0` — **separate worktrees**.
3. Both Sonnet builder loops run concurrently:
   - B1 acquires `lock:file:{proj}:src/routes/login.ts`, `…:src/auth/session.ts`.
   - B2 acquires `lock:file:{proj}:src/routes/billing.ts`, `…:src/billing/webhook.ts`.
   - **No shared paths → no contention → true parallelism.**
4. Both branches stream to their own `stream:run:{run_id}`; the canvas shows two lanes building live (`../03-generative-ui/realtime-ui.md`), each with logs, a growing diff, and a token meter.
5. Each branch passes its node test gates → `branch_status = built` → each enqueues onto `queue:integration`. Reconvergence is handled by `integration-merge.md` (one integration node merges B1+B2, runs the full gate).

Wall-clock ≈ max(B1, B2) instead of B1 + B2 — the speedup the success metrics target (`../00-overview/success-metrics.md`).

## 6. When the prediction was wrong at runtime

The engine declared B1 ⟂ B2, but at build time B2's model edits `src/auth/session.ts` (drift — `builder-agent.md §7`) — a file B1 also touches.

1. B2's builder attempts `write_file("src/auth/session.ts")` → JIT acquire `lock:file:{proj}:src/auth/session.ts` → **contended** (B1 holds it).
2. B2 pauses, streams `lock_contended { path, held_by_run, held_by_branch:B1 }` to its run stream (visible to the user immediately).
3. B2 waits up to `lock_wait_budget`:
   - **Released in time** → B2 acquires and continues — effectively **serialized** behind B1 on that one file. The branches are flagged as *not actually independent on `session.ts`*.
   - **Not released** → B2's node → `blocked`; branch emits `events.type = "branch.false_independence"` with the colliding path.
4. The orchestrator **flags false-independence**, removes the mutual `independent_of` entries, and triggers the engine to **re-derive** Stages 3–6 on B1/B2 (`dependency-inference-engine.md §4.4`, `replan-and-drift.md §4`). The likely outcome: a new hard edge (`file_overlap`/`sequence`) **demoting the pair to sequential**, or a node split that hoists the shared `session.ts` change into a shared prerequisite (`dependency-inference-engine.md §6`).
5. The canvas shows a **drift / false-independence notice**; the demoted branch is re-dispatched in the corrected order. No merge is ever attempted with both branches having mutated `session.ts` independently — the corruption is prevented at the lock, not discovered at merge.

This is the core promise: *a wrong prediction degrades gracefully to serialization + a visible correction, never to a silent bad merge.*

## 7. Observability of a parallel run

- **Per-branch live**: each branch's `stream:run:{run_id}` (logs, tool calls, diff chunks, token deltas) renders as a lane in the canvas; status pills follow `branch_status`/`node_status` via Supabase Realtime.
- **Lock view**: contended paths and who-holds-what are surfaced from the `lock_contended` stream events — the user sees serialization happen with a reason.
- **Run ledger**: `runs` rows carry `tokens`/`cost`/`started_at`/`finished_at` per node/branch → a parallel-run cost + wall-clock panel; mirrored to PostHog LLM-cost analytics.
- **Events feed**: `events` rows (`node.drift`, `branch.false_independence`, `node.built`, `branch.built`) form the auditable timeline of the dispatch.
- **Aggregate**: dispatched / running / built / blocked / failed counts per plan, plus realized speedup vs the sequential estimate (a `../00-overview/success-metrics.md` metric).

---

## To-do list

- [ ] "Dispatch parallel" action: select pairwise-proven-independent branch set (`independent_of[]`) (§1).
- [ ] Eligibility gate: ratified OR (overlap≈0 ∧ no shared symbol/file ∧ `resolution_confidence ≥ τ`) (§1).
- [ ] Branch-run worker: per-branch worktree off `base_commit`, internal topo order, cross-branch hard-edge gating (§2).
- [ ] `lock:branch:{id}` acquire/heartbeat to prevent double-dispatch (§2).
- [ ] `max_concurrent_branches` (per-plan + per-org) admission control (§4).
- [ ] BullMQ concurrency + queue backpressure on `queue:node-run` (§4).
- [ ] `ratelimit:org:{id}` integration to gate fan-out by cost/rate budget (§4).
- [ ] Lock-pressure backpressure (pause admission on widespread contention) (§4).
- [ ] Worktree disk-pressure cap + post-run GC coordination with builder (§4).
- [ ] False-independence handling: detect lock contention → flag, strip `independent_of`, trigger engine re-derive (§6).
- [ ] Demote-to-sequential / split-and-rehoist application from engine output (§6).
- [ ] Enqueue integration job on `branch_status=built` (§5, ties to `integration-merge.md`).
- [ ] Parallel-run observability: per-lane streams, lock view, run ledger, events feed, speedup metric (§7).
- [ ] PostHog: dispatch cost + realized-speedup analytics (§7).

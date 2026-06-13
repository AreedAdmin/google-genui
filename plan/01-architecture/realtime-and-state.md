# Realtime & State

> Status: **Canonical.** Defines the durable-vs-ephemeral state split, the BullMQ queues and their job lifecycles, the Redis Streams/locks/presence mechanics, cache invalidation, the optimistic-UI reconciliation rule, and the authoritative `plan_status`/`node_status` state machines.

This doc operationalizes [ADR-2 (durable vs ephemeral)](./high-level-architecture.md) and [ADR-3 (worktree-per-branch isolation)](./high-level-architecture.md). It consumes the Redis key schema, enums, and tables from [data-model.md](./data-model.md) verbatim, the queues from [tech-stack.md](./tech-stack.md), and feeds the Realtime channels enumerated in [api-design.md §13](./api-design.md).

---

## 1. The durable vs ephemeral split

Two state planes, one rule: **truth that the canvas must be able to reload lives in Postgres; high-frequency signal that would otherwise storm the DB lives in Redis.**

| Plane | Carries | Mechanism | Surfaced to client via |
|-------|---------|-----------|------------------------|
| **Durable (Supabase)** | `plans`, `plan_nodes`, `plan_edges`, `branches`, `runs`, `node_annotations`, `integration_nodes`, `delegations`, `shares`, `comments`, `events`, `feedback` — and every status field | Postgres rows + **Supabase Realtime** change feeds | Realtime channels `plan:`, `annotations:`, `runs:`, `comments:`, `events:` ([api-design.md §13](./api-design.md)) |
| **Ephemeral (Redis)** | job queues, distributed locks, run log/token/diff streams, presence, caches, rate-limit buckets | BullMQ, Redlock, Redis Streams, pub/sub, token buckets | the WS relay (`stream:run:`, `presence:`) |

Why split: streaming a Claude build emits thousands of token/diff events per run. Persisting each to Postgres would saturate write throughput and pollute Realtime. So **logs/tokens/diff-chunks ride Redis Streams**; only the **final** run row (status, tokens, cost, `diff_artifact_path`) and the archived log blob persist. A `run` that completes is fully reconstructable from Postgres + Storage; the live token stream is throwaway.

---

## 2. BullMQ queues & job lifecycles

Five durable queues on Redis (from [data-model.md §6](./data-model.md) / [tech-stack.md §2](./tech-stack.md)): `queue:plan-build`, `queue:node-run`, `queue:analysis`, `queue:integration`, `queue:replan`. Each is consumed by a dedicated worker pool that scales independently ([deployment-and-infra.md](./deployment-and-infra.md)).

| Queue | Produced by | Job payload | Worker | Writes | Locks |
|-------|-------------|-------------|--------|--------|-------|
| `plan-build` | `POST /plans` (Flow A) | `{ plan_id, run_id }` | Planner → Dependency-Inference | `plan_nodes`, `plan_edges`, `branches`; enqueues `analysis` per node | `lock:plan` |
| `analysis` | plan-build worker / replan | `{ node_id, plan_id, revision, run_id }` | Analysis/Annotation (Opus) | `node_annotations` (5 sections + `widget_specs`) | — |
| `node-run` | `/nodes/:id/run`, `/branches/:id/run`, `/run-selection` (Flow B) | `{ node_id, run_id, model }` | Builder (Sonnet) on worktree | `runs`, `plan_nodes.status/worktree_ref/diff_artifact_path` | `lock:node`, `lock:file` |
| `integration` | `/plans/:id/integrate`, branch-complete, `delegations.return` | `{ integration_node_id, run_id }` | Integration/Merge | `integration_nodes`, `branches.status`, `plans.status` | `lock:branch` |
| `replan` | `/plans/:id/replan` (Flow C), `/nodes/:id/split` | `{ plan_id, run_id, context, scope_node_ids }` | Replan/Drift (Opus) | `plan_revisions`, `plan_nodes`, `plan_edges`, `plans.current_revision` | `lock:plan` |

### Job lifecycle (BullMQ states)

```
added ─▶ waiting ─▶ active ─▶ completed
                      │
                      ├─▶ failed ──(attempts left)──▶ delayed(backoff) ─▶ waiting
                      └─▶ failed ──(exhausted)──────▶ failed (dead) ─▶ run.status=failed
```

- **Idempotency:** the BullMQ `jobId` **is** the `run_id`. A re-enqueue with the same `run_id` is deduplicated; on pickup the worker checks the `runs` row — if already `succeeded`, it no-ops ([data-model.md §8](./data-model.md)).
- **Retries:** automatic with exponential backoff for transient failures (Claude `503`, analysis-service timeout, Redis blips). Bounded attempts; on exhaustion the job is dead-lettered and the run transitions to `failed` (visible on `runs:{plan_id}`).
- **Visibility / restart safety:** a worker locks its job for a visibility window; if the worker dies, BullMQ's stalled-job check re-queues the job after the window. Because run state lives in Postgres/Redis (not worker memory), a re-queued job resumes idempotently ([architecture §5](./high-level-architecture.md)).
- **Concurrency:** per-worker concurrency is bounded; the **real** parallelism guard is the lock layer (§4), not queue concurrency.

---

## 3. Redis Streams for run output (logs / tokens / diff chunks)

Each run owns a stream at `runs.logs_stream_key` = **`stream:run:{run_id}`** ([data-model.md §6](./data-model.md)). The Builder/Planner/Analysis worker `XADD`s structured entries as it works:

```jsonc
// entries on stream:run:{id}
{ "t": "log",   "level": "info", "msg": "creating worktree ..." }
{ "t": "token", "delta": "export async function login(" }     // Claude token stream
{ "t": "diff",  "path": "src/auth/index.ts", "hunk": "@@ -1,4 +1,9 @@ ..." }
{ "t": "tool",  "name": "run_tests", "status": "passed" }
{ "t": "lock",  "path": "src/auth/session.ts", "state": "blocked", "reason": "held by branch B" }
{ "t": "end",   "status": "succeeded" }
```

### Client consumption (WS relay)

The client does **not** read Redis directly. It calls `GET /runs/:id/logs?follow=true` ([api-design.md §8](./api-design.md)); the API upgrades to WebSocket/SSE and **relays** the stream:

```
worker ──XADD──▶ stream:run:{id} ──XREAD(block)──▶ API relay ──WS frame──▶ client run console
```

- The relay `XREAD BLOCK`s from the client's last-seen stream ID (passed as `?from=`), so reconnects resume without gaps or replay.
- Streams are **trimmed** (`MAXLEN ~`) to bound memory; the **final** full log is archived to the `logs` Storage bucket on run completion, and the live stream is the source until then ([data-model.md §7](./data-model.md)).
- Token/diff frames drive the streamed-diff viewer and live build console; they are explicitly **not** Realtime/Postgres events ([ADR-2](./high-level-architecture.md)).

---

## 4. Distributed locks (Redlock) & the file-overlap backstop

Locks are `SET NX PX` / **Redlock** ([data-model.md §6](./data-model.md)). They prevent double-dispatch and enforce the physical parallel-safety guarantee that the [dependency engine](../02-agent-system/dependency-inference-engine.md) predicts.

| Lock | Granularity | TTL | Purpose |
|------|-------------|-----|---------|
| `lock:plan:{id}` | whole plan | 60s (renewed) | serialize replan/structural edits; no double plan-build |
| `lock:branch:{id}` | branch | 60s (renewed) | no double branch dispatch; held across branch run + integrate |
| `lock:node:{id}` | node | 60s (renewed) | no double node-run |
| `lock:file:{project}:{path}` | one repo path | **run-bound** | **cross-branch file-overlap guard** — the runtime backstop |

### The file-overlap backstop (the safety net behind prediction)

Per [dependency-engine §4.3](../02-agent-system/dependency-inference-engine.md): even a ratified-independent branch acquires `lock:file:{project}:{path}` for **every** path it touches at build time. If a Builder tries to touch a file another running branch holds, it **blocks/serializes** and `XADD`s a `lock` entry with a visible reason ([§3](#3-redis-streams-for-run-output-logs--tokens--diff-chunks)). This is physical safety: prediction can be wrong (touch-set drift), the lock cannot — two builders never write the same file concurrently. When a build's actual diff touches files **outside** its predicted touch-set, the Builder emits a drift event and the engine re-runs resolution Stages 3–6 on the affected nodes ([replan-and-drift.md](../02-agent-system/replan-and-drift.md)).

### TTL semantics & restart

- Control locks (`plan/branch/node`) carry a **60s** TTL and are **renewed** (lock-extension / watchdog) while the worker is alive. If a worker dies, the TTL lapses, the lock auto-releases, and the stalled job is re-queued — the re-queued run is idempotent on `run_id` ([architecture §5](./high-level-architecture.md)).
- `lock:file` is **run-bound**: released when the run reaches a terminal state (`succeeded`/`failed`/`cancelled`) or when its run-bound TTL lapses after a crash. Cancel (`POST /nodes/:id/cancel`) releases all held file locks immediately.
- **Redlock** is used for correctness across a Redis cluster (quorum acquisition) so a network partition cannot grant the same lock twice.

---

## 5. Presence

`presence:plan:{id}` is a Redis **hash + pub/sub** with a **30s heartbeat** TTL ([data-model.md §6](./data-model.md)). Each connected client `HSET`s `{ user_id → { cursor, selection, ts } }` and refreshes on a heartbeat; stale entries expire. Membership changes publish on the `presence:plan:{id}` pub/sub channel, which the WS relay forwards to the collaboration layer (avatars, live cursors, "editing node X"). Presence is **never** persisted — it is purely ephemeral and reconstructed on reconnect.

---

## 6. Caches & invalidation

| Key | Type / TTL | Populated by | Invalidated when |
|-----|-----------|--------------|------------------|
| `cache:symbolgraph:{project}:{commit}` | json string, 24h | analysis `index_repo` | a new commit is indexed (new key) — content-addressed by commit, so never stale |
| `cache:touchset:{node}:{rev}` | json string, 6h | analysis `resolve-touchset` | node's `revision` bumps (new key) or drift re-derivation invalidates `{node}:{rev}` |

Both caches are **commit/revision content-addressed**, so invalidation is "write a new key," not "purge an old one" — a stale read is impossible because the key embeds the version. The 24h/6h TTLs are memory hygiene, not correctness. TanStack Query holds the client-side cache of `GET` responses and is invalidated by the matching Realtime event (e.g. a `node:update` on `plan:{id}` invalidates that node's query key).

---

## 7. Optimistic UI reconciliation

The canvas applies user edits **optimistically** (Zustand local mutation) before the server confirms, then reconciles against the durable truth ([tech-stack.md §1](./tech-stack.md)):

1. **Apply** — user moves/edits a node; Zustand updates immediately; the change renders.
2. **Send** — the mutation `PATCH`es with `If-Match: <current_revision>` ([api-design.md §10](./api-design.md)).
3. **Reconcile** — the authoritative state arrives on the `plan:{id}` Realtime channel. The reducer treats the **Realtime row as truth**: if it matches the optimistic state, the optimistic flag clears; if it diverges (someone else edited, or the server adjusted), the Realtime value wins and the local state is rolled forward to it.
4. **Conflict** — a `409 conflict` (stale `If-Match`) tells the client its base revision is stale; it re-reads via `GET /plans/:id` and replays the user's intent against fresh state, or surfaces a merge prompt for structural edits.

Rule of thumb: **optimistic for latency, Realtime for truth.** Position edits (layout-cache only) never bump revision and reconcile trivially; structural edits (edges, splits) always defer to the Realtime/engine result.

---

## 8. `plan_status` state machine

States ([data-model.md §1](./data-model.md)): `draft | planning | ready | executing | partially_merged | merged | archived | failed`.

| From | To | Trigger |
|------|----|---------|
| `draft` | `planning` | `POST /plans` enqueues `queue:plan-build` |
| `planning` | `ready` | plan-build worker persists nodes/edges/branches successfully |
| `planning` | `failed` | plan-build exhausts retries (dead-lettered job) |
| `ready` | `planning` | `POST /plans/:id/replan` (re-flow; bumps `current_revision`) |
| `ready` | `executing` | first `node-run`/`branch-run`/`run-selection` job goes `active` |
| `executing` | `executing` | additional runs dispatched (stays until a merge boundary) |
| `executing` | `partially_merged` | an `integration` succeeds for some — not all — branches |
| `executing` / `partially_merged` | `merged` | all branches integrated clean; final integration `merge_commit` set |
| `executing` | `ready` | all in-flight runs cancelled/settled with nothing merged |
| `partially_merged` | `executing` | a remaining branch is dispatched |
| any non-terminal | `failed` | unrecoverable worker error (and no retries left) |
| `ready`/`merged`/`failed` | `archived` | `DELETE /plans/:id` (soft) or user archive |

`merged` and `archived` are terminal for forward flow; a re-plan from `merged` forks a new revision back to `planning`.

---

## 9. `node_status` state machine

States ([data-model.md §1](./data-model.md)): `pending | ready | running | built | merged | failed | blocked | skipped`.

| From | To | Trigger |
|------|----|---------|
| `pending` | `ready` | all upstream `depends_on` edges satisfied (predecessors `built`/`merged`); node has resolved touch-set |
| `pending`/`ready` | `blocked` | an upstream node `failed`, or a `lock:file` overlap cannot serialize within budget |
| `ready` | `running` | `node-run` job goes `active`; Builder creates worktree, acquires `lock:node` + `lock:file` |
| `running` | `built` | Builder produces a diff and the test gate passes; `diff_artifact_path` set |
| `running` | `failed` | build error / test-gate red / Claude exhausted retries |
| `running` | `ready` | run cancelled (`POST /nodes/:id/cancel`); locks released |
| `built` | `merged` | the node's branch integrates clean (`integration_nodes` → `merge_commit`) |
| `built` | `running` | re-run after edit or drift re-derivation |
| `blocked` | `ready` | the blocking condition clears (upstream rebuilt / lock freed) |
| `ready`/`pending` | `skipped` | user skips the node, or a `split`/replan supersedes it in a new revision |
| `failed` | `running` | user re-runs (new `run_id`) |

Node transitions emit on the `runs:{plan_id}` channel (the canvas badge live-updates) and aggregate upward into `branch_status` and ultimately `plan_status` (§8). `branch_status` (`idle→ready→running→built→merged|conflicted|failed`) follows its member nodes; a `conflicted` branch is one whose integration produced a non-empty `conflict_report` ([integration-merge.md](../02-agent-system/integration-merge.md)).

---

## To-do list

- [ ] Stand up BullMQ with the five queues, `jobId = run_id` idempotency, backoff retries, and stalled-job re-queue.
- [ ] Implement the worker pickup guard: skip if `runs` row already `succeeded`.
- [ ] Implement `stream:run:{id}` `XADD` from each worker (log/token/diff/tool/lock/end entries) with `MAXLEN ~` trimming.
- [ ] Implement the `GET /runs/:id/logs` WS/SSE relay with resumable `XREAD BLOCK` from `?from=` and archive-to-`logs`-bucket on completion.
- [ ] Implement Redlock helpers for `lock:plan/branch/node` (60s + watchdog renewal) and run-bound `lock:file`.
- [ ] Implement the file-overlap backstop in the Builder: acquire `lock:file` per touched path, block/serialize with a visible stream reason, emit drift events.
- [ ] Implement presence (`presence:plan:{id}` hash + pub/sub, 30s heartbeat) and the WS relay forward.
- [ ] Implement content-addressed caches (`cache:symbolgraph`, `cache:touchset`) and TanStack-Query invalidation on Realtime events.
- [ ] Implement optimistic-UI reducer: apply → send with `If-Match` → reconcile against Realtime → handle `409` re-read.
- [ ] Encode the `plan_status` and `node_status` transition tables as a guarded state machine in the API + workers (reject illegal transitions with `409`).
- [ ] Roll `node_status` → `branch_status` → `plan_status` aggregation and emit on `runs:{plan_id}`.

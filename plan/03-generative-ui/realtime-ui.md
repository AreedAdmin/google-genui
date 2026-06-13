# Realtime UI — Live Behavior, Streaming & Optimistic State

> Status: **Canonical.** Specifies how the Trellis client stays live: subscribing to Supabase Realtime (durable state) and Redis run-streams via a WS relay (high-frequency signal), optimistic edits with reconciliation, live re-flow animation, streaming analysis/widgets into the inspector, presence, resync, and the Zustand + TanStack Query state model.
>
> **Amended by [mandated-integrations.md](../01-architecture/mandated-integrations.md)** — the agent→canvas live transport is now **AG-UI consumed by CopilotKit** (`useCoAgent`/`useCopilotAction`, headless); Supabase Realtime stays the durable multi-user truth plane (two-plane hybrid). See §3.1, §4, §6.

This implements the "iterate in real time" promise from [scope §2](../00-overview/scope.md) and the "re-flow on change" hook from [`granularity-layouts.md` §5](./granularity-layouts.md). It honors the canon split from [tech-stack §5](../01-architecture/tech-stack.md): **Supabase Realtime carries durable state changes; Redis carries ephemeral, high-frequency signal.** Reads on the component system in [`component-library.md`](./component-library.md) and the streamed widgets in [`widget-generation.md`](./widget-generation.md).

---

## 1. The two live channels (and why two)

```
            DURABLE state (Postgres rows)              EPHEMERAL signal (Redis)
 ┌──────────────────────────────────────┐   ┌──────────────────────────────────────┐
 │ Supabase Realtime (Postgres CDC, WS)  │   │ Redis Streams  →  WS relay (api)      │
 │  plan / node / edge / run / branch /  │   │  stream:run:{id}  (logs, tokens,      │
 │  delegation / event row changes       │   │  diff chunks)   ·  presence:plan:{id} │
 │  RLS-scoped; ~per-change; ordered      │   │  high-freq; lossy-ok; never hits PG    │
 └──────────────────────────────────────┘   └──────────────────────────────────────┘
        TanStack Query cache patches               Zustand stream buffers (ephemeral)
```

- **Supabase Realtime** ([tech-stack §4](../01-architecture/tech-stack.md)) streams **row-level changes** for the entities a user can see (RLS-enforced). These are the *facts*: a node moved to `built`, an edge was added, a delegation was `accepted`. They patch the **TanStack Query** cache.
- **Redis Streams** ([data-model §6](../01-architecture/data-model.md), `stream:run:{id}`, `presence:plan:{id}`) carry **logs, tokens, diff chunks, and presence** — too frequent and too disposable to write to Postgres on every tick. The browser cannot speak Redis, so a **WS relay** in the Fastify API ([tech-stack §2](../01-architecture/tech-stack.md)) bridges `XREAD`/`XREADGROUP` → WebSocket frames, authorizing the subscription against the same RLS rules. These feed **Zustand** ephemeral buffers.

This division is the whole performance story: the DB sees one write when a run *completes*, not 10k writes while it streams.

---

## 2. Channel subscriptions (what the client opens)

| Scope | Transport | Subscribes to | Drives |
|-------|-----------|---------------|--------|
| **Plan** (canvas open) | Supabase Realtime | `plan_nodes`, `plan_edges`, `branches`, `plan_revisions`, `events` for `plan_id` | canvas re-render, re-flow, activity feed |
| **Plan presence** | WS relay → `presence:plan:{id}` | cursors, viewers, who's-editing | presence layer ([component-library](./component-library.md)) |
| **Node** (inspector open) | Supabase Realtime | `node_annotations`, `comments`, `runs(node_id)` | streamed sections/widgets, comments |
| **Run** (node/branch running) | WS relay → `stream:run:{id}` | log lines, token deltas, diff chunks, progress | live log pane, streaming diff, progress |
| **Delegation** | Supabase Realtime | `delegations(plan_id)` | delegation status ([collaboration-ui](./collaboration-ui.md)) |

Subscriptions are **scoped to what's mounted**: opening a plan subscribes plan-level; opening a node adds node-level; starting a run opens that run's stream and **closes it on terminal status** (`succeeded|failed|cancelled`) — bounded fan-in. Leaving the canvas tears all of them down (§9).

---

## 3. State management (Zustand + TanStack Query)

Clear ownership prevents the classic realtime double-source bug:

- **TanStack Query owns server/durable state** — plans, nodes, edges, annotations, runs (terminal), delegations. It's the cache of record. Realtime row events **patch query data** via `queryClient.setQueryData` keyed by entity (`['plan', id]`, `['node', id]`, `['runs', planId]`). Background refetch reconciles on focus/reconnect.
- **Zustand owns client/ephemeral UI state** — selection, layout mode/tier override, density toggles, optimistic overlays, **run-stream buffers** (rolling log/diff/token buffers, capped), presence cursors, in-flight mutation registry. None of this is persisted to Postgres except via explicit mutations.
- **Bridge**: a thin subscriber turns Supabase events → query-cache patches, and WS-relay frames → Zustand buffer appends. Components read derived state (`useNode(id)` merges query data + optimistic overlay + live run buffer) so a node card shows facts + in-flight edits + streaming progress coherently.

```
Supabase Realtime ─▶ cachePatch()      ─▶ TanStack Query cache ─┐
WS relay (Redis)  ─▶ bufferAppend()    ─▶ Zustand stream/presence┼─▶ useNode()/useRun() ─▶ UI
user action       ─▶ optimisticApply() ─▶ Zustand overlay       ─┘     (merged view)
```

### Cache invalidation
- **Targeted, not nuke-all**: a `plan_nodes` event patches `['node', id]` and the node list; it does not invalidate the whole plan. Edge/branch events that change topology mark the **layout dirty** (re-flow, §6) rather than refetching everything.
- **Revision-aware**: every domain row carries `revision` ([data-model §8](../01-architecture/data-model.md)). A re-plan bumps `plans.current_revision`; the client switches the active-revision selector and queries are keyed by `(id, revision)`, so historical revisions stay cached and the canvas can diff revisions ([`replan-and-drift.md`](../02-agent-system/replan-and-drift.md)) without clobbering current data.
- **Run completion**: the WS stream's terminal frame triggers a single `invalidateQueries(['runs', planId])` + `['node', id]` to pull the durable result/diff artifact, then the ephemeral buffer is dropped.

---

## 4. Optimistic UI on user edits

Editor-role actions ([data-model share_role](../01-architecture/data-model.md)) feel instant: apply locally, send, reconcile.

| Action | Optimistic effect | Reconciliation |
|--------|-------------------|----------------|
| **Ratify edge** (accept/reject an independence/dependency claim) | edge style flips immediately ([component-library §3](./component-library.md)); branch independence recolors | server re-derives; Realtime confirms or corrects the edge/branch |
| **Add context** (iteration panel) | context chip appears; node enters a "re-planning" shimmer | replan job emits new revision; canvas re-flows (§6) |
| **Move node** (layout) | node follows cursor; position cached | `plan_nodes.position` persisted; others see it via Realtime |
| **Add/remove node, edit title/summary** | element appears/updates instantly | mutation persists; Realtime echo de-duped (§5) |
| **Assign / delegate** | assignee avatar appears on node/branch | delegation row created; Realtime confirms ([collaboration-ui](./collaboration-ui.md)) |

Mechanics: each optimistic edit registers a `mutationId` + an inverse patch in the Zustand overlay. On server ack (Realtime echo or mutation 200) the overlay entry is cleared; on error/timeout the inverse patch rolls back and a toast offers retry. Optimistic overlays render with a subtle "pending" treatment so users see it isn't yet durable.

### Server reconciliation & conflict handling
- **Echo de-dup**: our own writes come back over Realtime; the bridge drops events whose `mutationId`/payload match a pending optimistic entry (no flicker).
- **Concurrent edits** (two editors): last-writer-wins per *field* by default; **structural conflicts** (one user deletes a node another is editing; both re-point the same edge) are detected server-side and surfaced as a non-destructive **conflict toast** with "keep mine / take theirs / open both" — no silent overwrite (matches [scope §8](../00-overview/scope.md) "append-and-revise, nothing silently overwritten"). True concurrent graph co-editing (CRDT) is deferred per [tech-stack §8](../01-architecture/tech-stack.md); v1 relies on optimistic + reconciliation, and `multi-user-sync.md` ([collaboration-ui](./collaboration-ui.md)) owns the policy.

---

## 5. Live re-flow animation (re-plan & drift)

When the plan topology changes — tier promote/demote ([`granularity-layouts.md` §5](./granularity-layouts.md)), a re-plan, or detected **drift** ([`replan-and-drift.md`](../02-agent-system/replan-and-drift.md)) — the canvas **animates from old layout to new** instead of snapping.

1. New `LayoutSpec`/nodes/edges arrive (Realtime: a new `plan_revisions` row + changed nodes/edges).
2. The client diffs old vs new graph: **added / removed / moved / restyled** nodes and edges (keyed by stable node id).
3. The layout engine ([`granularity-layouts.md` §5](./granularity-layouts.md)) computes target positions for the new `canvas` strategy.
4. **FLIP-style transition** over `--motion-flow` ([component-library §1](./component-library.md)): surviving nodes glide to new positions, new nodes fade+scale in, removed nodes fade out, re-typed nodes cross-fade their accent/widget. Edges re-route along animated paths; a changed edge pulses once.
5. A **"re-planned · revision N → N+1"** banner offers *undo to previous revision* (revisions are durable, [data-model](../01-architecture/data-model.md)). Drift-triggered re-flows additionally mark *which* nodes drifted.
6. `prefers-reduced-motion` ⇒ a single cross-fade, no motion.

This animated re-flow is a headline generative-UI moment: the user literally watches the agent re-compose the plan.

---

## 6. Streaming analysis & widgets into the inspector (skeleton → filled)

Opening a node while its analysis is generating shows **progressive fill**, not a spinner:

- The five sections ([scope §2](../00-overview/scope.md): Changes, Assumptions, Analysis, Benefits, Notable symbols) each render a **Skeleton** ([component-library §6](./component-library.md)) and fill as the analysis agent streams.
- Two streaming paths, by durability:
  - **Token-level preview** (optional, low-latency): the agent's partial annotation streams over the run's `stream:run:{id}` → WS relay → a "drafting…" shimmer in the section. Disposable; never the source of truth.
  - **Durable fill**: when `node_annotations` is written/updated, Realtime patches `['node', id]` and the section snaps to the validated content. **Widgets** ([`widget-generation.md`](./widget-generation.md)) appear the same way — `entry.Skeleton` first, then the validated `WidgetSpec` renders once present (and re-validated client-side).
- **Live diff** (during a node build): diff chunks stream over the run channel into `DiffView` ([component-library §5](./component-library.md)) — appended incrementally, then the final durable diff artifact replaces the buffer on run completion (§3).

---

## 7. Presence (cursors / avatars)

- Each viewer heartbeats to `presence:plan:{id}` (Redis hash + pub/sub, 30s TTL — [data-model §6](../01-architecture/data-model.md)) with `{user, cursor:{x,y}, focus:node_id, color}`. The WS relay fans presence to all plan viewers.
- The **PresenceLayer** ([component-library §5](./component-library.md)) draws colored cursors with name tags and an **AvatarStack** of who's here; a node being edited by someone else shows their avatar + a soft outline (feeds the conflict UX, §4).
- Cursor/focus updates are **throttled to ~20/s** client-side and coalesced server-side; presence is lossy by design (a dropped frame is fine).
- Stale entries (missed heartbeat) auto-expire via TTL; the client also prunes on `presence:leave`.

---

## 8. Performance (batching & throttling high-freq streams)

The DAG + live streams must stay smooth at G3/G4 scale.

- **Coalesced render**: Realtime events and stream frames are buffered into an animation-frame flush (one React commit per frame), not one render per event. A burst of node updates re-renders once.
- **Throttle by stream type**: log lines ~10/s with a rolling cap (older lines virtualized/dropped from the live buffer; full log is the durable archive). Token deltas batched per frame. Cursor updates ~20/s (§7). Diff chunks flushed per frame.
- **Bounded buffers**: Zustand stream buffers are ring buffers (cap N lines / M KiB) — long runs never grow memory unbounded; the canonical full log is in Storage ([data-model §7](../01-architecture/data-model.md)).
- **Virtualized lists**: log pane, activity feed, and large node lists virtualize; only on-screen nodes mount heavy widgets (off-screen show the card shell).
- **Subscription scoping** (§2): never subscribe to runs that aren't active; close run streams on terminal status.
- **Backpressure**: the WS relay drops intermediate frames under load for lossy streams (logs/tokens/presence) but **never drops durable Realtime events** (those are the facts).
- **Semantic-zoom gating** (G4): at low zoom, super-nodes don't subscribe to child run streams until expanded ([`granularity-layouts.md` §2](./granularity-layouts.md)).

---

## 9. Connection loss & resync

- **Detection**: Supabase Realtime and the WS relay both heartbeat; a missed beat flips a global **connection state** (`live | reconnecting | offline`) shown as an unobtrusive status chip; optimistic edits are still allowed but queued.
- **Reconnect**: exponential backoff with jitter. On Realtime reconnect, **refetch the authoritative state** for the open plan/node (TanStack `invalidate` on the mounted query keys) so any missed row changes are reconciled — Realtime is not assumed gap-free, the DB is the source of truth.
- **Run streams**: on WS reconnect, resume `stream:run:{id}` from the last seen Redis stream ID (`XREAD` after `last-id`); if the run already finished, drop the stream and pull the durable result/diff (§3).
- **Queued mutations**: edits made while offline replay on reconnect through the same optimistic→reconcile path (§4); conflicts surface via the conflict toast.
- **Presence**: simply re-heartbeats; stale cursors expire on their own.

---

## To-do list

### Transport
- [ ] Supabase Realtime subscriptions (plan/node/edge/branch/revision/event/delegation), RLS-scoped, mount-scoped.
- [ ] WS relay in Fastify bridging `stream:run:{id}` + `presence:plan:{id}` → WebSocket, authorized per RLS.
- [ ] Subscription lifecycle: open on mount/run-start, close on unmount/terminal status.

### State
- [ ] TanStack Query as durable cache; Realtime → targeted `setQueryData` patches; revision-keyed queries.
- [ ] Zustand stores: selection/layout/density, optimistic overlay (mutationId + inverse), ring-buffered run/presence streams.
- [ ] `useNode`/`useRun` merged selectors (facts + optimistic + live buffer); echo de-dup of own writes.

### Optimistic & reconciliation
- [ ] Optimistic ratify-edge / add-context / move-node / add-remove-node / assign with rollback + retry toast.
- [ ] Conflict detection (structural) → non-destructive conflict toast (keep mine / take theirs / open both).

### Re-flow & streaming
- [ ] Graph diff (added/removed/moved/restyled) + FLIP re-flow over `--motion-flow`; revision undo banner; reduced-motion path.
- [ ] Inspector skeleton→filled: token preview (ephemeral) + durable annotation/widget fill; streamed `DiffView`.

### Presence, perf, resync
- [ ] Presence heartbeat + PresenceLayer (cursors/avatars) + edited-by indicator; throttle ~20/s.
- [ ] requestAnimationFrame coalescing; per-stream throttles; bounded buffers; list virtualization; backpressure (lossy vs durable).
- [ ] Connection-state chip; backoff reconnect + authoritative refetch; run-stream resume from last id; offline mutation replay.

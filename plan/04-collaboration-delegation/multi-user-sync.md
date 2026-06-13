# Multi-User Sync & Concurrency

> Status: **Canonical.** Defines how multiple users concurrently view and edit one Plan: presence, optimistic edits with server reconciliation, conflict resolution, locking, and the activity feed — and why v1 uses Supabase Realtime + optimistic UI rather than full CRDT. (Supports **D12**.)

A Plan is a live, multi-user surface. Two reviewers and an editor can be on the same canvas while agents stream build diffs into it. This doc is the concurrency contract that keeps that coherent without overbuilding.

---

## 1. The two transport planes (recap)

Per [`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md#5-redis-control-plane), sync rides two planes with a clean division:

- **Supabase Realtime** — carries **durable** state changes: Postgres change feeds on `plan_nodes`, `plan_edges`, `branches`, `runs`, `integration_nodes`, `events`. This is the source of truth; every client converges on what the DB says.
- **Redis** — carries **ephemeral, high-frequency** signal: presence (`presence:plan:{id}`), live log/token/diff streams (`stream:run:{id}`), and the distributed locks that make edit/run safe (`lock:plan:{id}`, `lock:node:{id}`, `lock:file:{project}:{path}`).

Durable truth flows over Realtime; transient "who's here / what's streaming / who holds the lock" flows over Redis. Clients never write canonical state to Redis.

---

## 2. Presence

Presence answers "who is on this Plan, and what are they looking at / touching."

- Each connected client heartbeats into `presence:plan:{id}` (a Redis hash, 30s TTL per the data-model key schema, refreshed on a ~10s interval) with `{ user_id, display_name, avatar_url, cursor/selected_node, mode: viewing|editing, last_seen }`.
- Presence changes fan out over Redis pub/sub to all subscribers on the Plan; the canvas renders avatars, per-user selection highlights, and an "editing node X" indicator (`../03-generative-ui/collaboration-ui.md`).
- TTL expiry = implicit disconnect; a client that stops heartbeating drops off within one TTL window. No explicit "leave" is required (covers crashes/closed tabs).
- Presence is **advisory** — it informs the UI and the soft-lock UX (§5) but is never the security boundary; RLS (`sharing-model.md` §5) is.

---

## 3. Optimistic edits + server reconciliation

Editors (role ≥ `editor`) mutate the plan structure; we want the canvas to feel instant without lying about what's durable.

**The loop:**

1. **Apply locally (optimistic).** An editor action (move node, edit summary, add/remove edge, split node, ratify a branch) is applied immediately to the Zustand client store and the canvas re-renders. The action is tagged with a client-generated `op_id` and the `revision` it was based on.
2. **Send to server.** The mutation hits the Fastify API (`../01-architecture/api-design.md`), which validates role (RLS + `editor`), validates the payload (zod), and applies it against the *current* DB revision inside a transaction.
3. **Reconcile.** The DB write fans out over Supabase Realtime to **all** clients, including the originator. Each client reconciles the authoritative row against its optimistic state:
   - **Confirmed** — the server's result matches the optimistic op (by `op_id`/result hash): the optimistic entry is cleared; no visual change.
   - **Corrected** — the server result differs (it rebased the op, or the op was rejected): the client **rolls back** the optimistic change and applies the authoritative state. The user sees a brief correction, never silent divergence.
4. **Server is always right.** There is no "client wins." The DB row + `revision` is canonical; optimistic state is a prediction that the reconciliation either confirms or overwrites.

**Granularity of an "op":** edits are scoped to the smallest entity (a node field, one edge, one branch's ratification flag) so two editors touching *different* entities never conflict — they're independent writes that both land. Conflicts only arise on the *same* entity (§4).

---

## 4. Conflict resolution for simultaneous edits

When two editors mutate the **same** entity concurrently:

| Entity / field | Resolution |
|---|---|
| **Node scalar field** (title, summary, position, change_type) | **Last-write-wins by server commit order**, scoped to the field. The reconciliation shows the loser a correction. Field-level scoping means editing a node's title and its summary concurrently both succeed. |
| **Node split / structural rewrite** | Requires the **node edit-lock** (§5). The second editor is blocked from starting the structural op until the lock releases — structural rewrites are serialized, not merged. |
| **Edge add/remove** | Edges are keyed by `(from_node, to_node, type)`; concurrent identical adds dedupe, concurrent add+remove resolves by commit order with a correction. |
| **Ratification** (independence claim) | Serialized under the node/branch lock; ratification is `editor`-only and safety-critical (`../02-agent-system/dependency-inference-engine.md` §7), so it takes the lock, applies, and fans out — never two-writers-merge. |
| **Replan** | A replan produces a **new `plan_revision`** (`../01-architecture/data-model.md#plan_revisions`); it takes the **plan-level lock** so two replans can't race. A replan in flight blocks concurrent structural edits (they'd be rebased onto a revision that's about to change). |

The principle: **scalar fields use field-scoped last-write-wins; structural and safety-critical changes are serialized under a lock.** No structural change is ever lost or silently merged.

---

## 5. Locking semantics (edit vs run)

Two distinct lock concerns — *don't let two people redesign the same thing at once* (edit) and *don't let two builds corrupt the same files* (run):

### Edit locks (soft, advisory, short)
- A **node edit-lock** (`lock:node:{id}`, Redlock, ~60s, renewed while focused) is taken when an editor begins a structural op (split, replan-this-node, drag-restructure). It is **advisory + UI-enforced**: the canvas shows "Alice is editing this node," and a second editor's structural op is blocked with that reason. Scalar field edits do **not** require the lock (they reconcile per §4).
- The **plan-level lock** (`lock:plan:{id}`) is held for the duration of a replan to serialize whole-plan re-derivation.
- Edit locks auto-expire (TTL) so a crashed editor never wedges the plan.

### Run locks (hard, physical, safety-critical)
- These are the **same locks the orchestrator uses** (`../02-agent-system/parallel-orchestration.md`), not a separate concept: `lock:branch:{id}` (no double-dispatch) and `lock:file:{project}:{path}` (cross-branch file-overlap guard, run-bound TTL).
- Run locks are **enforced at execution**, not advisory — even a ratified-independent branch acquires per-file locks at build time; a build touching a file another running branch holds **blocks or serializes** with a visible reason. This is the physical backstop behind the predicted-independence safety (`../02-agent-system/dependency-inference-engine.md` §4).

### Edit-vs-run interaction
- **A node that is `running` is structurally frozen for editing.** You cannot split/replan a node whose build is in flight; the canvas surfaces "building — edit locked until it finishes." Scalar annotations (comments) are still allowed.
- A **replan** cannot start while any node it would re-derive is `running`; it queues until the run settles (or the user cancels the run). This prevents re-deriving the touch-sets out from under a live build.
- Runs and *unrelated* edits proceed freely — editing node B's summary while node A builds is fine.

---

## 6. Activity feed

The activity feed is the human-readable, chronological projection of the `events` table (`../01-architecture/data-model.md#events`) for a Plan, rendered live over Realtime:

- **Sources:** edit events (`node.created/updated/split`, `edge.added/removed`, `branch.ratified`, `replan.committed`), run events (`run.started/succeeded/failed`, `integration.merged/conflicted`), share events (`share.*` from `sharing-model.md` §7), and delegation events (`delegation.sent/accepted/returned/merged/declined` from `subtree-delegation.md` §4).
- Each entry: `actor`, `type`, a humanized summary, target node/branch link, and timestamp. Append-only; survives revocation (an ex-collaborator's past actions remain attributed).
- The feed is the single audit + awareness surface: "who replanned, who ran what, who I shared with, what came back from a delegation." It complements presence (who's *here now*) with history (what *happened*).
- Comments (`../01-architecture/data-model.md#comments`) thread on nodes and also surface in the feed when created/resolved.

---

## 7. Why v1 is Realtime + optimistic UI, not CRDT

This is a deliberate, documented choice (echoed in `../01-architecture/tech-stack.md` §8 rejected-alternatives and tracked in `../06-appendix/open-questions.md`).

**What we're actually synchronizing:** a **graph of coarse, structured entities** (nodes, edges, branches) with mostly-disjoint, field-scoped edits — *not* a shared rich-text document with fine-grained concurrent character insertions. The hard case CRDTs solve (two people typing into the same paragraph and merging intent character-by-character) **does not occur** in our edit model: we don't have free-form collaborative prose; we have field-scoped structured ops and lock-serialized structural changes.

Given that, **Supabase Realtime (DB-as-source-of-truth) + optimistic UI + field-scoped last-write-wins + locks for structural/safety changes** gives us:

- Correctness that's easy to reason about and audit (the DB row is canonical; reconciliation is deterministic).
- No second source of truth to keep consistent with Postgres/RLS (a CRDT doc would have to be reconciled with the relational model the agents and RLS depend on).
- Far less complexity to build, test, and operate in the v1 timeline.

**What would push us to CRDT / Yjs later** (the trigger conditions, recorded in open-questions):

- A genuinely **concurrent free-text surface** appears where two users must co-edit the same prose simultaneously (e.g. collaborative editing of a node's long-form spec/summary as a shared document, not field-replace).
- **Offline / poor-connectivity co-editing** becomes a requirement (CRDTs merge divergent offline histories; our optimistic model assumes a live server).
- Reconciliation **corrections become frequent and jarring** at scale (many editors on one hot node), i.e. last-write-wins visibly loses too much intent.

Until one of those is real, CRDT is over-engineering for a structured-graph editor. The decision is revisitable — see `../06-appendix/open-questions.md` (OQ on CRDT vs Realtime).

---

## 8. Failure & edge cases

- **Realtime disconnect / reconnect:** on reconnect the client refetches the current `revision` of the Plan (TanStack Query) and rebases any pending optimistic ops; ops based on a now-stale revision are re-validated server-side and corrected if needed. No lost-update on reconnect.
- **Split-brain optimism:** an editor who made several optimistic edits while briefly disconnected has them replayed and individually reconciled on reconnect; rejected ops roll back visibly.
- **Lock holder vanishes:** TTLs guarantee edit/run locks self-heal; the plan never permanently wedges.
- **Viewer/runner attempting an editor op:** rejected by RLS *and* hidden in the UI; surfaced as `share.denied` in events.

---

## To-do list

### Presence
- [ ] `presence:plan:{id}` heartbeat (client ~10s, 30s TTL) carrying user + selection + mode.
- [ ] Pub/sub fan-out → canvas avatars, per-user selection, "editing node X" indicator (`../03-generative-ui/collaboration-ui.md`).

### Optimistic edits + reconciliation
- [ ] Client op model: `op_id` + base `revision`; field-scoped optimistic apply in Zustand.
- [ ] Server: role + zod validation, transactional apply at current revision, Realtime fan-out.
- [ ] Reconciliation: confirm / correct (rollback + apply authoritative) by `op_id`.

### Conflict & locking
- [ ] Field-scoped last-write-wins for node scalars; edge dedupe/commit-order; ratification serialized.
- [ ] Node edit-lock (advisory, TTL) for structural ops; plan-lock for replan; reuse run locks from `../02-agent-system/parallel-orchestration.md`.
- [ ] Edit-vs-run freeze rules (running node not structurally editable; replan waits on live runs).

### Activity feed
- [ ] Live `events` projection into a chronological feed (edit/run/share/delegation/comment sources).
- [ ] Append-only, revocation-surviving attribution; node/branch deep links.

### Resilience
- [ ] Reconnect rebase of pending ops against refetched revision; replay + reconcile.
- [ ] Lock self-heal verification (TTL expiry tests); `share.denied` surfacing.

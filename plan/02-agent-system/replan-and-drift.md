# Replan & Drift (real-time iteration and self-correction)

> Status: **Canonical.** Defines how the plan stays in sync with reality: the **Replan** agent (Claude **Opus 4.8**) turns added user context into a new, diffable `plan_revision` with *incremental* dependency re-derivation; and the **Drift** loop re-derives the engine on nodes whose actual build diff escaped their predicted `touch_set`, surfacing notices and demoting parallel branches to sequential when needed — all without losing the live canvas or looping forever.

Two forces push the plan out of sync: the **user** (adds context, the plan must re-flow — **Flow C**, `../01-architecture/high-level-architecture.md`) and **reality** (a build touches more than predicted — the drift consumer named in `builder-agent.md §7` and `dependency-inference-engine.md §4.4`). Both converge on the same machinery: produce a new revision, re-derive only what changed, keep the canvas live, stay versioned (ADR-6), and guarantee convergence.

## 1. Replan vs Drift (two triggers, one engine)

| | **Replan** | **Drift** |
|--|-----------|-----------|
| Trigger | User adds context / edits intent (`POST /plans/:id/replan`) | A build's actual diff exceeds its predicted `touch_set` (`builder-agent.md §7`) |
| Driver | **Replan agent (Opus 4.8)** re-decomposes | Engine re-derivation (no LLM re-decompose unless structure must change) |
| Scope | Whole intent, but re-derive only changed touch-sets | The affected nodes + their blast-radius neighbors |
| Output | New `plan_revision` (diffable) | Updated edges/branches; new revision **only if** structure changes |
| Convergence risk | Re-plan thrash | Drift→re-derive→drift loops |

Both write through the same versioning + incremental re-derivation core (§3, §5).

## 2. Replan: user adds context → new revision

```
POST /plans/:id/replan   { added_context }
  Worker(Replan, Opus 4.8):
    diff intent (prior prompt + revision vs added_context)
    re-decompose ONLY the affected region of the DAG → revised Nodes/predicted touch-sets
    reuse unchanged nodes/annotations by identity (stable node ids where possible)
  Engine: incremental re-derivation on changed touch-sets only (§3)
  Persist: new plan_revisions row (revision++, reason, diff jsonb)  → ADR-6
  Realtime: canvas re-flows; revision is diffable vs prior (§4 live, §6 versioning)
```

- **Opus 4.8** drives structural re-decomposition (deep reasoning); **Sonnet 4.6** handles small incremental node edits where structure is stable (`../01-architecture/tech-stack.md §6`) — the planner chooses based on the size of the intent diff.
- Node **identity is preserved** wherever the change is recognizably the same unit of work, so the canvas diffs (added/removed/changed nodes & edges) rather than re-rendering from scratch, and existing `node_annotations` / built diffs are reused.
- Latency budget: incremental re-plan **< ~8s** (`../00-overview/scope.md §8`).

## 3. Incremental dependency re-derivation (only changed touch-sets)

We do **not** re-run the whole 7-stage pipeline. We re-run **Stages 3–6** of `dependency-inference-engine.md §3` scoped to the affected set:

1. Compute `changed_nodes` = nodes whose predicted/resolved `touch_set` changed (replan) or whose actual diff drifted (drift).
2. `affected = changed_nodes ∪ blast-radius neighbors` — nodes sharing files/symbols/types/schema/config with a changed node (via the analysis service's overlap), plus direct hard-edge neighbors.
3. Re-run **Stage 3** (resolve touch-sets) → **Stage 4** (derive edges) → **Stage 5** (classify independence) → **Stage 6** (rebuild DAG region + branch partition + integration nodes) on `affected` only.
4. Cache reuse: `cache:touchset:{node}:{rev}` and `cache:symbolgraph:{project}:{commit}` (`../01-architecture/data-model.md §6`) mean unchanged nodes are not re-resolved; the symbol graph is re-indexed incrementally only on a new `base_commit`.
5. Re-apply ratification: a branch the user **ratified independent** keeps that status unless its touch-set materially changed; if it did, the engine clears ratification and re-flags for a fresh handshake (`dependency-inference-engine.md §7`).

## 4. Drift: build diff exceeds the predicted touch-set

The builder emits drift signals during a run and posts the **actual** path/symbol set on completion (`builder-agent.md §7`). The drift handler:

1. **Ingest** `events.type = "node.drift"` and the post-run actual diff for `node_id`.
2. **Re-derive** Stages 3–6 on the affected set (§3) with the *actual* touch-set replacing the predicted one for the drifted node.
3. **Consequences**:
   - New edges may appear (e.g. the drifted file is consumed by another node → new `depends_on`).
   - A previously-parallel branch may be **demoted to sequential**: if the drift makes two branches share a mutated file/symbol, the engine adds a `file_overlap`/`signature_change` hard edge and strips the mutual `independent_of[]` (`dependency-inference-engine.md §6 "Serialize"`). The orchestrator re-orders dispatch accordingly (`parallel-orchestration.md §6`).
   - A node may be **split** or a shared prerequisite **hoisted** if the drift reveals a shared dependency (`dependency-inference-engine.md §6`).
4. **Surface a drift notice** on the canvas: the affected nodes/edges get a "drift" badge with the evidence (which file/symbol escaped, what edge it created), tied to the live-UI in `../03-generative-ui/realtime-ui.md`. If structure changed, a **new `plan_revision`** is written (reason = `"drift"`).
5. **Runtime safety already held** during the drifting build — the `lock:file` backstop (`builder-agent.md §5`) prevented any concurrent collision while this re-derivation catches up. Drift correction updates the *plan*; it never races the *build*.

The same handler is invoked when integration finds a conflict between predicted-independent branches (`integration-merge.md §8`) — that, too, is drift, surfaced one stage later.

## 5. Keeping the canvas live

- All re-derivation writes flow through Supabase Realtime (ADR-2): node/edge/branch/revision changes fan to subscribed clients; the canvas re-flows in place (added/removed/moved nodes animate, edges re-route) rather than reloading. Detail in `../03-generative-ui/realtime-ui.md`.
- High-frequency build signal stays on Redis (`stream:run:{id}`), durable structure on Postgres — so a re-plan storm never floods the canvas with raw log noise.
- Optimistic UI: user edits to intent show immediately; the authoritative revision reconciles when the worker completes.
- A revision in flight is marked `planning`; the prior revision stays fully operable until the new one is ready (no blank canvas).

## 6. Versioning & rollback

- Every replan **and** every structure-changing drift writes a `plan_revisions` row (`revision`, `reason`, `diff jsonb`, `created_by`) — append-and-revise, **never silent overwrite** (ADR-6, `../00-overview/scope.md §8`).
- All mutable domain rows carry `revision` (`../01-architecture/data-model.md §8`), so the canvas can render **any historical revision** and **diff two revisions** (added/removed/changed nodes, edges, touch-sets).
- **Rollback** = create a new revision whose content equals an earlier one (`reason = "rollback to rN"`); history is never destroyed. Already-built node diffs from the rolled-to revision are reusable by identity.
- `plans.current_revision` points at the active revision; runs reference the revision they executed against.

## 7. Convergence guarantees (no infinite re-plan / drift loops)

Self-correction must terminate. Guarantees:

1. **Drift is monotonic on touch-sets.** Each drift *expands* a node's resolved touch-set (toward the true blast radius) or *adds* an edge; the touch-set graph only grows toward reality, which is finite (bounded by the repo's symbol graph). It cannot oscillate indefinitely.
2. **Re-derivation is idempotent on a fixed diff.** Running Stages 3–6 twice on the same actual touch-set yields the same edges/branches — no flapping.
3. **Demotion is one-way within a run.** A branch demoted to sequential by drift is not re-promoted to parallel mid-dispatch; re-promotion only happens via an explicit new plan/replan, not the drift loop.
4. **Replan budget & debounce.** Rapid successive `replan` calls are debounced; a per-plan cap on automatic re-derivations per dispatch window trips a **"needs manual review"** state instead of looping. Cost guards (`ratelimit:org:{id}`) bound LLM re-decomposition.
5. **Human in the loop on structural churn.** If re-derivation would repeatedly re-split the same node, the engine stops auto-correcting and surfaces a ratification request (`dependency-inference-engine.md §7`) — bounded automation, then a human decision.

Net: drift converges because it only ever moves the plan **toward** the true dependency structure (a finite target); replan converges because it is user-initiated, debounced, versioned, and capped.

---

## To-do list

- [ ] `POST /plans/:id/replan`: Replan agent (Opus 4.8) re-decompose with node-identity preservation (§2).
- [ ] Opus-vs-Sonnet routing by intent-diff size (§2).
- [ ] Incremental re-derivation: compute `affected` set, re-run engine Stages 3–6 scoped only (§3).
- [ ] Touch-set / symbol-graph cache reuse for unchanged nodes (§3).
- [ ] Ratification carry-over / clear-on-material-change logic (§3, §5).
- [ ] Drift handler: ingest `node.drift` + post-run actual diff; re-derive affected nodes (§4).
- [ ] Demote-to-sequential + strip `independent_of[]` on drift-induced overlap; re-order dispatch (§4).
- [ ] Node split / shared-prerequisite hoist on revealed shared dependency (§4).
- [ ] Drift notice on canvas with evidence (ties to `../03-generative-ui/realtime-ui.md`) (§4).
- [ ] Integration-conflict → drift re-derivation entrypoint (§4, ties to `integration-merge.md §8`).
- [ ] Live canvas re-flow via Supabase Realtime; `planning` interim state keeps prior revision operable (§5).
- [ ] `plan_revisions` write on replan + structural drift; `diff jsonb` for revision diffing (§6).
- [ ] Revision rendering + two-revision diff in the canvas (§6).
- [ ] Rollback as new-revision-equal-to-earlier; `plans.current_revision` pointer (§6).
- [ ] Convergence controls: replan debounce, per-window re-derivation cap → "needs manual review", one-way demotion (§7).

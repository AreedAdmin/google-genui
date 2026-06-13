# Builder Agent (single-node execution)

> Status: **Canonical.** Defines how one `plan_node` is turned into a reviewable diff: an ephemeral git worktree off `base_commit`, a Claude **Sonnet 4.6** tool-use loop bounded by the node's `touch_set`, file-level distributed locks as the parallel-safety backstop, a per-node test gate, and the drift signal emitted when the build escapes its predicted blast radius.

The builder is the atom of execution. Parallelism (`parallel-orchestration.md`), reconvergence (`integration-merge.md`), and live re-derivation (`replan-and-drift.md`) all compose *instances* of this loop. This doc specifies the loop itself and the safety contracts every instance must honor. It implements **Flow B** (run a branch) from `../01-architecture/high-level-architecture.md` at the granularity of a single node.

> **Runner context (read first):** per-node execution is **pluggable** — the user selects which agentic coding tool ("runner") does the building, and **v1/the demo uses Claude Code (headless)**. See [agent-runners.md](./agent-runners.md). This doc, the Sonnet 4.6 tool-use loop, is the built-in **native runner** — one implementation of the `AgentRunner` interface — *and* the spec for the safety contracts the orchestration layer enforces around **every** runner (worktree isolation §3, drift detection §7, the test gate §8, idempotency §6, status machine §2). External runners (e.g. Claude Code) don't honor the in-loop `lock:file` gating of §5; for them, Trellis enforces the same invariant via per-branch worktree isolation + an end-of-run diff audit (see [agent-runners.md §1](./agent-runners.md)). The §4–§5 in-loop mechanics below are specific to the native runner.

## 1. Contract (inputs / outputs)

**Inputs** (from the `node-run` job payload — `queue:node-run`):
- `run_id` — the `runs.id`; **idempotency key** (ADR-6, `../01-architecture/data-model.md §8`).
- `node_id`, `plan_id`, `revision`, `branch_id` — the node and its lane.
- `base_commit` — the commit the worktree forks from (the branch's integration base, see §3).
- `touch_set` (resolved) — the predicted blast radius from the dependency engine (`dependency-inference-engine.md §3`, `../01-architecture/data-model.md §5`): `resolved.files[]`, `resolved.symbols[]`, `resolved.signatures_changed[]`, `resolved.schema_keys[]`, `resolved.config_keys[]`.
- `node_annotations` — assumptions/risks/notable symbols injected as guidance (the builder reads them; it does not regenerate them).

**Outputs**:
- A **diff artifact** in Storage bucket `diffs` → `plan_nodes.diff_artifact_path`.
- `plan_nodes.worktree_ref` (the worktree's branch ref) and the produced commit SHA in `runs.result`.
- A terminal `node_status` (`built` | `failed` | `blocked` | `skipped`) and `runs.status` (`succeeded` | `failed` | `cancelled`).
- A streamed log/diff timeline on `stream:run:{run_id}`.
- Zero or more **drift signals** (`events.type = "node.drift"`) when actual edits escape `touch_set` (§7).

## 2. Lifecycle & status transitions

```
pending ─(dispatched)─▶ ready ─(worktree + locks acquired)─▶ running
running ─(loop ok + test gate green)──────────────────────▶ built
running ─(test gate red, retries exhausted)───────────────▶ failed
running ─(lock contention, cannot serialize in budget)────▶ blocked
ready   ─(dependency failed / node obsoleted by replan)───▶ skipped
```

- `node_status` is the durable truth in Postgres; `runs.status` tracks this *execution attempt*. A node may have several `runs` rows (retries, re-dispatch after worker death) but one terminal `node_status`.
- Transitions are written via the Orchestration API path so Supabase Realtime fans them to the canvas. The worker never writes UI state directly; it writes domain rows + Redis streams (ADR-2).

## 3. Worktree creation (isolation)

Per **ADR-3** (worktree-per-branch isolation):

1. The branch run (`parallel-orchestration.md`) holds `lock:branch:{branch_id}` and owns `branches.worktree_path`. Nodes within a branch build **sequentially in that one worktree**, in topological order of the branch's internal hard edges — so a node's `base_commit` is the branch's HEAD *after* prior nodes in the same branch committed. Across branches, each branch has its **own** worktree off the plan's `base_commit`, giving physical isolation.
2. The builder creates/uses the worktree:
   ```
   git worktree add --detach <wt_path> <base_commit>
   git switch -c run/<plan_id>/<branch_id>     # branch-scoped working ref (first node only)
   ```
   `wt_path` is recorded on `branches.worktree_path`; the per-node working ref is recorded on `plan_nodes.worktree_ref`.
3. Worktrees are **ephemeral and sandboxed** — resource/network-limited per `../01-architecture/security-and-auth.md`. They are GC'd after the branch merges or fails (the underlying object data is preserved via the produced commit until integration).
4. On **worker death**: `lock:branch` (TTL 60s, `../01-architecture/data-model.md §6`) expires; the branch run is re-queued; the new worker reattaches to `branches.worktree_path` if present, or recreates it from `base_commit`. Idempotency (§6) makes a re-run of an already-`succeeded` node a no-op.

## 4. The Claude (Sonnet 4.6) tool-use loop

Builder uses **Claude Sonnet 4.6** (high-volume, cost-sensitive build — `../01-architecture/tech-stack.md §6`). The system prompt carries the **prompt-cached repo-context block** (symbol summaries + conventions, cached once per plan) plus the node's `summary`, `touch_set`, and relevant annotations.

**Tools exposed** (all schema-validated with zod; see `prompts-and-tools.md`):

| Tool | Purpose | Guardrail |
|------|---------|-----------|
| `read_file(path)` | read source for context | path must be inside the worktree |
| `search(query)` | ripgrep / symbol search in the worktree | read-only |
| `write_file(path, contents)` | create/modify a file | **path-gate** against `touch_set` + `lock:file` (§5, §7) |
| `apply_patch(path, hunk)` | targeted edit | same path-gate |
| `delete_file(path)` | remove a file | path-gate |
| `run_tests(scope?)` | execute the test gate | scoped to node touch-set by default (§8) |
| `analysis_lookup(symbol)` | query the Python analysis service for callers/refs | helps the model respect blast radius |

**Loop shape** (bounded):

```
1. Plan the edits from summary + touch_set (model reasons; no writes yet).
2. read_file / search to ground the edits in real code.
3. For each touched path: acquire lock:file (§5) → write_file/apply_patch.
4. run_tests(scope) → the node test gate (§8).
5. If red and budget remains: read failures, repair, goto 3 (bounded by max_repair).
6. If green: stage + commit; produce diff artifact; release locks; node_status=built.
```

Every model turn, each tool call, and each diff hunk is appended to `stream:run:{run_id}` so the client renders **live logs + a growing diff** (`../03-generative-ui/realtime-ui.md`). Token deltas stream too, for the cost meter.

## 5. File-level locking — the parallel-safety backstop

This is the **physical safety net behind the predicted one** (ADR-3; `dependency-inference-engine.md §4.3`). Even a *ratified-independent* branch must prove non-collision at write time.

- **Before the first write to any path** `p`, the builder acquires `lock:file:{project}:{path}` (Redlock `SET NX`, TTL **run-bound** — refreshed by a heartbeat while the run holds it; `../01-architecture/data-model.md §6`).
- The lock set is computed from `resolved.files` up front; additionally, *any* path the model attempts to write that is not already locked triggers a just-in-time acquire (and a drift check, §7).
- **On contention** (the path is held by another concurrent branch's run):
  1. The builder does **not** force-write. It pauses and emits a visible reason to `stream:run:{run_id}`: `lock_contended { path, held_by_run, held_by_branch }`.
  2. It waits up to `lock_wait_budget` (default 90s) for release.
  3. If released in time → acquire → continue (effectively **serialized** behind the other branch on that file).
  4. If not released → the node transitions to **`blocked`**; the branch run reports a **false-independence event** (`events.type = "branch.false_independence"`) naming the colliding path/branch, which the engine consumes to **re-derive** Stages 3–6 and demote the pair to sequential (`replan-and-drift.md §4`, `dependency-inference-engine.md §6 "Serialize"`). The user sees a drift notice; the node is re-dispatched once the conflict is serialized.
- Locks are released on commit (success), on terminal failure, and on TTL expiry (dead worker). A released lock that other branches were waiting on wakes the longest waiter.

> Why this matters: the dependency engine is a *prediction*. Locking makes the guarantee real — **no two concurrent branches ever mutate the same file**, by construction, regardless of prediction quality. Prediction errors degrade to *lost parallelism + a visible flag*, never to a corrupted merge (asymmetric-caution, `dependency-inference-engine.md §4.2`).

## 6. Idempotency

- `run_id` is the idempotency key (`../01-architecture/data-model.md §8`). The worker's first action is a guarded transition `runs(run_id): queued → running`; if the row is already `succeeded`, the job is a **no-op** (returns the prior `result`/diff path).
- The produced commit is deterministic-enough to discard: a re-dispatch that finds `node_status = built` and a present `diff_artifact_path` returns immediately.
- Partial work from a dead worker is abandoned (worktree recreated from `base_commit`); we never resume a half-written file set — we redo the node. This keeps the lock invariant clean.

## 7. Drift handling (build escapes the predicted touch-set)

The predicted `touch_set` is a hypothesis. When reality exceeds it, we must tell the engine — this is the consumer side of the drift loop owned by `replan-and-drift.md §4`.

- **Detection**: a `write_file`/`apply_patch`/`delete_file` to a path **not** in `resolved.files` (or a signature change not in `resolved.signatures_changed`) is *out-of-prediction*.
- **Policy** (not a hard block — the build often legitimately needs an unforeseen file):
  1. Just-in-time acquire `lock:file:{project}:{path}` for the new path (so safety still holds). If contended → §5 contention path.
  2. Emit a **drift signal**: `events.type = "node.drift"` with `{ node_id, run_id, predicted: false, path, kind: "file_outside_touchset" | "signature_outside_touchset" }`, also pushed to `stream:run:{run_id}`.
  3. Continue the build (locked), accumulating the actual diff.
- **On node completion**, the worker posts the **actual diff's path/symbol set** to the engine's drift hook. The engine re-runs Stages 3–6 on the affected nodes (`dependency-inference-engine.md §4.4`), which may add edges, **demote a parallel branch to sequential**, or split a node. The canvas shows a **drift notice** (`replan-and-drift.md §4`, `../03-generative-ui/realtime-ui.md`).
- Drift never silently mutates the plan: it produces a new analysis the user can see and (if it changes structure) a new `plan_revision`.

## 8. Test gate (per node)

- Default scope: tests **reachable from the node's touch-set** (the analysis service maps touched symbols → covering test files); falls back to the project's fast suite if the mapping is empty.
- The gate runs inside the sandboxed worktree via `run_tests`. **Green is required to reach `built`.** A red gate after exhausting `max_repair` repair turns → `node_status = failed`.
- The gate result is recorded on `runs.result` and streamed. Integration later re-runs the **full** gate after merge — a green node gate is necessary but not sufficient (`integration-merge.md §4`). **No path auto-merges on a red gate** (ADR-1, `integration-merge.md`).

## 9. Cost & latency controls

- **Model**: Sonnet 4.6 (cheaper, faster than Opus) for the build loop; Opus is reserved for plan/analysis/replan (`../01-architecture/tech-stack.md §6`).
- **Prompt caching**: the repo-context block is cached once per plan and reused across every node build, cutting per-node input cost/latency.
- **Bounded loop**: caps on `max_turns`, `max_repair`, `max_tokens_per_run`, and `wallclock_budget`; exceeding a cap fails the run with a clear reason (eligible for retry per §10).
- **Scoped reads**: the model is steered to `read_file`/`search` only within the blast radius; `analysis_lookup` replaces brute-force repo scans.
- **Cost guards**: `ratelimit:org:{id}` / `ratelimit:user:{id}` token buckets (`../01-architecture/data-model.md §6`) throttle dispatch; each run writes `runs.tokens` / `runs.cost` for the meter and PostHog LLM-cost analytics.

## 10. Failure & retry semantics

| Failure | Detection | Response |
|---------|-----------|----------|
| Transient Claude/API error | SDK error / timeout | retry with backoff in-loop; bounded attempts. |
| Tool-output schema invalid | zod validation fails | bounded **repair** retries (re-prompt with the validator error). |
| Test gate red | `run_tests` non-zero after `max_repair` | `node_status = failed`; surfaced with failing tests; user may edit node + re-dispatch. |
| Lock contention unresolved | `lock_wait_budget` elapsed | `node_status = blocked` + false-independence event → engine serializes; re-dispatch. |
| Budget exceeded | cap hit | `failed` with reason; eligible for retry or node split. |
| Worker death | `lock:branch`/`lock:node` TTL expiry | run re-queued; idempotent re-run (§6); worktree recreated. |
| Dependency failed upstream | prior node in branch `failed` | node → `skipped`; branch → `failed` (no merge attempt). |

Retries are governed by the queue (BullMQ) with capped attempts + exponential backoff. A node that exhausts retries leaves the plan in a state the user can act on (edit, split, or abandon the branch); the rest of the DAG is unaffected because of worktree isolation.

## 11. Worked micro-example

Node *N* = "add `createSession`", `change_type = logic`, `touch_set.resolved.files = ["src/auth/session.ts"]`, on branch *B* off `base_commit = c0`.

1. `node-run` dequeued; `runs(run_id): queued→running`. Worktree exists at `branches.worktree_path` (B's lane).
2. Builder acquires `lock:file:{proj}:src/auth/session.ts` — uncontended.
3. Sonnet loop: `read_file("src/auth/index.ts")` (context), `write_file("src/auth/session.ts", …)`. Each step streams to `stream:run:{run_id}`.
4. The model also wants to touch `src/auth/types.ts` (not predicted) → JIT lock acquire + **drift signal** `node.drift{path:"src/auth/types.ts"}`.
5. `run_tests(scope=auth)` → green. Commit; diff artifact → `diffs/…`; `plan_nodes.diff_artifact_path` set; `worktree_ref` recorded.
6. Locks released; `node_status = built`. Worker posts actual diff to the engine drift hook → engine re-resolves N's blast radius incl. `types.ts`; canvas shows a drift notice; if `types.ts` is shared with another parallel branch, that branch is demoted to sequential.

---

## To-do list

- [ ] `node-run` worker: dequeue, idempotent `run_id` guard, status machine (§2, §6).
- [ ] Worktree lifecycle: create off `base_commit`, branch-scoped working ref, reattach-on-restart, sandboxed GC (§3).
- [ ] Sonnet 4.6 tool-use loop with prompt-cached repo-context block (§4).
- [ ] Builder tool set (`read_file`/`search`/`write_file`/`apply_patch`/`delete_file`/`run_tests`/`analysis_lookup`) with zod validation (§4).
- [ ] Path-gate writes against `touch_set`; JIT lock + drift on out-of-prediction paths (§5, §7).
- [ ] `lock:file:{project}:{path}` acquire/heartbeat/release + contention handling (block/serialize with visible reason) (§5).
- [ ] False-independence event emission on unresolved contention → engine re-derive hook (§5, §10).
- [ ] Drift signal emission (`events.type=node.drift`) + post-completion actual-diff push to engine drift hook (§7).
- [ ] Per-node test gate scoped to touch-set; green-required-for-`built` (§8).
- [ ] Diff artifact production → `diffs` bucket + `plan_nodes.diff_artifact_path` (§1).
- [ ] Live streaming of logs/tool-calls/diff/tokens to `stream:run:{run_id}` (§4).
- [ ] Cost/latency caps (`max_turns`/`max_repair`/`max_tokens_per_run`/`wallclock_budget`) + rate-limit integration (§9).
- [ ] Failure/retry policy (backoff, repair retries, blocked/skipped paths) (§10).
- [ ] Record `runs.tokens`/`runs.cost`/`runs.result` for the meter + PostHog LLM-cost analytics (§9).

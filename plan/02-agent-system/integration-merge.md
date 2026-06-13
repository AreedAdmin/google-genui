# Integration & Merge (branch reconvergence)

> Status: **Canonical.** Defines how finished branches reconverge: an **Integration node** merges branch worktrees onto a fresh integration worktree (sequential merge of branch diffs), runs the **full** test gate, detects conflicts, and — per **ADR-1** — **never auto-merges on red tests or unresolved conflicts**, handing off to the agent-assisted, user-adjudicated conflict UI before producing the final `merge_commit` / PR.

Reconvergence is where parallelism (`parallel-orchestration.md`) pays its debt. Branches were built in isolation (`builder-agent.md`, ADR-3); integration is the single point where their diffs meet. It implements the tail of **Flow B** (`../01-architecture/high-level-architecture.md`). The `integration_nodes` table (`../01-architecture/data-model.md §2`) is the durable record.

## 1. When integration runs

- The dependency engine inserts an **Integration node** wherever branches reconverge (`dependency-inference-engine.md §3 Stage 6`).
- When every branch in `integration_nodes.target_branches` reaches `branch_status = built`, the orchestrator enqueues an integration job on **`queue:integration`** (`parallel-orchestration.md §5`).
- The integration job holds `lock:plan:{id}` (or a narrower lock over the target branch set) so two integrations of overlapping branches cannot race.

## 2. Integration node lifecycle

```
pending ─(all target branches built)──────────▶ merging
merging ─(clean merges + full gate green)──────▶ merged
merging ─(merge conflict OR red gate)──────────▶ conflicted
conflicted ─(agent+user resolve, gate green)───▶ merged
merging/conflicted ─(unrecoverable)────────────▶ failed
```

Tracked on `integration_nodes.status` (`pending | merging | conflicted | merged | failed`). The plan moves through `plan_status`: `executing → partially_merged → merged` (`../01-architecture/data-model.md §1`). `partially_merged` is the real state when some branches merged and others are stuck on conflicts (§7).

## 3. Merge procedure

We use **sequential merge onto a clean integration worktree** (not blind git octopus) so conflicts are detected per-branch with clear provenance:

1. **Create integration worktree** off the plan's `base_commit` (the common ancestor all branches forked from):
   ```
   git worktree add <wt_integ> <base_commit>
   git switch -c integ/<plan_id>/<integration_node_id>
   ```
2. **Order the branches** for merge: branches with cross-branch hard edges merge in dependency order; otherwise by size ascending (small diffs first surface conflicts cheaply). A true octopus (`git merge b1 b2 …`) is attempted *only* as a fast-path when the engine proved all target branches pairwise disjoint (`independent_of[]` covers the set) — it succeeds instantly with zero conflicts in the common case, and we fall back to sequential on any failure.
3. **Merge each branch's commit** in turn (`git merge --no-ff <branch_ref>`):
   - **Clean** → continue to the next branch.
   - **Conflict** → capture the conflicted paths/hunks (§5), stop accumulating, set `status = conflicted`, branch to the resolution flow (§6). Already-clean branches stay applied (partial progress, §7).
4. **After all branches apply clean**, run the **full test gate** (§4).
5. On green → commit the integration → `merge_commit`; on red → `conflicted` even though git merged textually (a *semantic* conflict, §5).

> Branch isolation (separate worktrees + `lock:file`) means **textual** same-file conflicts are rare for engine-proven-independent sets — the lock discipline already prevented two branches from writing the same file (`parallel-orchestration.md §3`). Integration's job is to catch the residue: cross-branch *semantic* breakage and any pair that slipped through and was serialized late.

## 4. The full test gate (necessary, not optional)

- Per-node gates (`builder-agent.md §8`) only validate a node's local touch-set. Integration runs the **project's full test suite** on the combined worktree — the only place cross-branch interactions are exercised.
- **Green is mandatory to reach `merged`.** Per **ADR-1**, **a red gate blocks the merge**: no `merge_commit`, no PR. The integration node goes `conflicted` (semantic) and hands off to §6.
- Gate result + the failing set are recorded on the integration run (`runs.result`) and streamed to `stream:run:{run_id}` for live visibility.

## 5. Conflict detection & `conflict_report` shape

Two conflict classes, both captured into `integration_nodes.conflict_report`:
- **Textual** — git reported merge conflicts (overlapping hunks).
- **Semantic** — clean textual merge but the **full gate is red** (e.g. B1 changed a signature B2 still calls the old way; the per-node gates passed in isolation but the combination breaks).

```jsonc
// integration_nodes.conflict_report
{
  "kind": "textual" | "semantic",
  "base_commit": "c0",
  "branches": ["<branchB1>", "<branchB2>"],
  "merged_clean": ["<branchB1>"],          // applied before the conflict
  "textual": [
    {
      "path": "src/auth/session.ts",
      "ours_branch": "<branchB1>",
      "theirs_branch": "<branchB2>",
      "hunks": [{ "start": 42, "end": 58, "ours": "…", "theirs": "…" }]
    }
  ],
  "semantic": [
    {
      "failing_tests": ["auth/session.test.ts::renews token"],
      "suspected_symbols": ["src/auth/session.ts#createSession"],
      "suspected_branches": ["<branchB1>", "<branchB2>"],
      "evidence": "signature createSession(ttl) changed by B1; called as createSession() in B2"
    }
  ],
  "agent_attempt": {
    "model": "claude-sonnet-4.6",
    "status": "proposed" | "applied" | "failed",
    "resolution_diff_path": "diffs/integ/<id>.patch",
    "rationale": "…"
  }
}
```

When a conflict appears between branches the engine **predicted independent**, the orchestrator also emits `events.type = "branch.false_independence"` and triggers engine re-derivation on the pair (§8, `dependency-inference-engine.md §4.4`).

## 6. Resolution: agent attempts, user adjudicates (handoff)

Per **ADR-1**, resolution is agent-assisted but human-ratified — **never auto-merge on red**:

1. **Agent attempt** (Claude Sonnet 4.6): given `conflict_report` + the two diffs + relevant analysis, the agent proposes a resolution patch on the integration worktree (`agent_attempt.resolution_diff_path`). It **re-runs the full gate** on its proposal.
2. **If the agent's proposal is green**, it is presented to the user as a **proposed resolution** — still requiring confirmation. The UI handoff (`../03-generative-ui/node-inspector.md`, conflict view) shows the conflicting hunks side-by-side, the agent's proposed merge, the failing→passing test delta, and Accept / Edit / Reject.
3. **If the agent cannot make it green** (or it's textual and ambiguous), the integration node stays `conflicted` and the user adjudicates manually in the conflict UI; they can edit hunks, re-run the gate, or send a branch back to the builder with guidance.
4. **The merge commits only on an explicit user accept *and* a green full gate.** This is the hard rule: red tests + unresolved conflict ⇒ no merge.

## 7. Partial-merge state

- If some branches merged clean and others are stuck `conflicted`, the plan is **`partially_merged`** (`../01-architecture/data-model.md §1`). The clean branches' work is preserved on the integration worktree/commit; the canvas shows which branches are integrated vs pending.
- The user can ship the partial integration as a PR now (`merge_commit` of the clean subset) and resolve the rest in a follow-up, or hold for full resolution. The plan reaches `plan_status = merged` only when all target branches are integrated.
- A branch that cannot be resolved can be **abandoned** (its diff dropped) without losing the integrated remainder — isolation makes this clean.

## 8. Strategies when branches conflict despite predicted independence

| Situation | Strategy |
|-----------|----------|
| Late-serialized same-file edit (caught at lock, `parallel-orchestration.md §6`) | Already serialized; integration usually clean. If residual, agent-resolve → user-ratify. |
| Textual overlap that slipped through | Capture hunks; agent proposes; **re-derive** the pair → add `file_overlap` hard edge so future dispatch serializes them (`dependency-inference-engine.md §6`). |
| Semantic break (signature/type) across branches | The engine *should* have made this a hard `signature_change` edge; its appearance is a drift signal → re-derive Stage 3–6, flag false-independence, demote to sequential, optionally **hoist** the shared change into a prerequisite node both depend on. |
| Migration ordering collision | Enforce `sequence` edge; re-run migrations in dependency order on the integration worktree. |

Every such conflict feeds back into the engine (`replan-and-drift.md §4`) so the plan's structure self-corrects and the same false-independence is not repeated. This is the integration-side half of the drift loop.

## 9. Producing the final `merge_commit` / PR

- On `merged`: the integration worktree's commit is recorded as `integration_nodes.merge_commit`; `plan_status → merged`.
- The orchestrator opens (or updates) a **PR** against the project's `default_branch` from the integration commit, with a generated body summarizing nodes, branches, the analysis highlights, and any resolved conflicts. (Delegated subtrees may merge back through this same path — `../04-collaboration-delegation/subtree-delegation.md`.)
- The combined diff is archived to the `diffs` bucket; the full integration log archives from `stream:run:{id}` to the `logs` bucket.
- The PR is the human-review boundary: Trellis never pushes to `default_branch` directly (ADR-1 spirit — a ratifiable artifact precedes the irreversible action).

---

## To-do list

- [ ] Integration worker on `queue:integration`; trigger when all `target_branches` are `built` (§1).
- [ ] `lock:plan:{id}` / target-set lock to serialize overlapping integrations (§1).
- [ ] Integration-node lifecycle + `plan_status` transitions incl. `partially_merged` (§2, §7).
- [ ] Sequential merge onto a clean integration worktree off `base_commit`; octopus fast-path for proven-disjoint sets (§3).
- [ ] Merge ordering (hard-edge order, else size-ascending) (§3).
- [ ] Full test gate on the combined worktree; green-required-for-`merged` (ADR-1) (§4).
- [ ] Textual + semantic conflict detection → `conflict_report` JSON (§5).
- [ ] Agent (Sonnet 4.6) resolution attempt + gate re-run on the proposal (§6).
- [ ] Conflict-resolution UI handoff (side-by-side hunks, proposed merge, test delta, Accept/Edit/Reject) (§6, ties to `../03-generative-ui/node-inspector.md`).
- [ ] Hard rule: no `merge_commit` without explicit accept **and** green full gate (§6).
- [ ] Partial-merge support: ship clean subset, preserve/abandon stuck branches (§7).
- [ ] False-independence feedback → engine re-derive on conflicting predicted-independent pairs (§5, §8).
- [ ] Strategy application: add `file_overlap`/`signature_change`/`sequence` edges, hoist shared prerequisite (§8).
- [ ] `merge_commit` + PR generation against `default_branch`; archive combined diff/logs (§9).

# Subtree Delegation — the portable plan

> Status: **Canonical.** Defines Trellis's most original primitive: selecting a subtree of a Plan and exporting it as a self-contained, runnable **portable spec** that can be handed to another user or agent, built independently, and merged back. (Delivers **D14**; pillar **P3**.)
>
> **Amended by [mandated-integrations.md](../01-architecture/mandated-integrations.md)** — delegation to another user/agent is realized as an **A2A** task hand-off; the portable spec is the A2A message/artifact and results return over the A2A task lifecycle (the `delegations.return` integration step is unchanged). See §3.2.

> **"GitHub for plans."** A pull request makes a *diff* portable. A subtree delegation makes a *unit of planned work* portable — the changes, their dependency structure, the grounded analysis, the exact repo state they were reasoned against, and the contract for putting the results back. You can hand it to a teammate, a contractor, or an autonomous agent, and get a mergeable result back without either side holding the whole plan in their head.

---

## 1. Why this is differentiating

Every competitor (`competitive-landscape.md`) ships a *linear* plan that lives inside their tool and is built by their agent. None of them lets you **excise a coherent slice of planned work and move it across a trust boundary as a portable, runnable artifact.** Three properties make Trellis able to do this where others can't:

1. **The plan is already a grounded DAG.** A subtree (a root node + its descendants) is a well-defined, dependency-closed unit because we computed the edges in the first place (`../02-agent-system/dependency-inference-engine.md`). We know precisely what the slice touches (resolved touch-sets) and precisely how it connects to the rest (the cut edges).
2. **Independence is computed, so the cut is safe.** We already know whether the subtree is conflict-free with the parent's remaining work. The same overlap analysis that powers parallel dispatch tells us whether a delegation is a clean cut or one that will collide on return.
3. **The integration contract is derivable.** Because we know the cut edges, we know exactly what the subtree must *provide* back (symbols/signatures/schema the parent consumes) and what it *requires* from the parent (the base state). That contract is what makes the handoff runnable in isolation and mergeable on return.

This turns delegation from "send a Slack message describing some work" into a typed, versioned, reintegrable transfer — at G4 (`../00-overview/scope.md` §3) it is the *primary* way large plans get done.

---

## 2. Selecting a subtree

On the canvas (`../03-generative-ui/graph-canvas.md`) the user picks a **root node**; the selection auto-closes over descendants in the **hard-edge** dependency graph:

- The subtree = the root + all nodes reachable from it via `depends_on`/`data_flow`/`sequence`/`signature_change` edges that are *internal* to the selection, such that the slice is **dependency-closed** (no internal node depends on a node left outside, except through the declared integration contract).
- **Cut edges** are edges crossing the boundary:
  - **Inbound cut** (parent node → subtree node): a prerequisite the subtree *requires*. The provider must already exist in `base_commit`, or the subtree cannot start — surfaced as a precondition.
  - **Outbound cut** (subtree node → parent node): something the parent consumes from the subtree. This is the **return obligation** — the symbols/signatures/schema the subtree must deliver.
- The export tool **refuses or warns** when the chosen root produces a slice with high-overlap cut edges (the cut isn't clean) and offers the §6 conflict strategies (split / hoist a shared prerequisite) *before* exporting, reusing the dependency engine's conflict-resolution machinery (`../02-agent-system/dependency-inference-engine.md` §6). A delegation should be a clean cut by construction.

---

## 3. The portable-spec format

The export produces a single self-contained JSON document, written to the `specs` Storage bucket (`../01-architecture/data-model.md#7-storage-buckets-supabase-storage`) and referenced by `delegations.spec_path`. It is **self-describing and versioned** so a recipient tool (or a future Trellis instance) can open it without the parent plan present.

```jsonc
{
  "spec_version": "1.0",
  "kind": "trellis.portable_spec",
  "delegation_id": "uuid",
  "origin": {
    "plan_id": "uuid",
    "plan_revision": 7,                  // parent revision this was cut from
    "subtree_root_node": "uuid",
    "exported_by": "uuid",
    "exported_at": "2026-06-13T..."
  },

  // ── The runnable plan slice ───────────────────────────────
  "nodes": [                             // full plan_nodes rows for the subtree
    {
      "local_id": "n1",                  // stable id within the spec
      "title": "...", "change_type": "api_contract", "granularity": "g2_meso",
      "summary": "...",
      "touch_set": { "predicted": {...}, "resolved": {...}, "resolution_confidence": 0.82 }
    }
  ],
  "edges": [                             // internal edges only (cut edges live in integration_contract)
    { "from": "n1", "to": "n2", "type": "depends_on", "evidence": {...}, "overlap_score": 0.0 }
  ],
  "annotations": {                       // P2 grounded analysis, per node, frozen at export
    "n1": { "assumptions": [...], "analysis": [...], "benefits": [...], "notable_symbols": [...], "widget_specs": [...] }
  },

  // ── The repo state it was reasoned against ────────────────
  "repo": {
    "project_ref": "github.com/org/repo",
    "base_commit": "a1b2c3…",            // EXACT commit the touch-sets/analysis are valid against
    "default_branch": "main",
    "required_paths": ["src/auth/**", "src/db/schema.ts"],   // the slice the recipient must be able to read/edit
    "languages": ["ts"]
  },

  // ── The contract back to the parent ───────────────────────
  "integration_contract": {
    "requires": [                        // INBOUND cuts — must exist in base_commit before building
      { "symbol": "src/db/client.ts#getDb", "kind": "function", "provided_by_parent_node": "uuid|external" }
    ],
    "provides": [                        // OUTBOUND cuts — the return obligation the parent will consume
      { "symbol": "src/auth/session.ts#createSession", "signature": "(uid)->Promise<Session>", "consumed_by_parent_node": "uuid" }
    ],
    "must_not_touch": ["src/billing/**"],// files outside the slice the recipient is contractually barred from editing
    "merge_target": { "parent_plan_id": "uuid", "parent_revision": 7 }
  },

  // ── Integrity ─────────────────────────────────────────────
  "checksums": { "spec_sha256": "…", "node_count": 4, "edge_count": 3 },
  "policy": { "role": "runner", "external": false, "sandboxed_slice": true }
}
```

Field notes:

- **`resolved` touch-sets are baked in** so the recipient sees the real symbols/blast-radius without re-running the analysis service against the parent's index — though they *will* re-resolve against their own `base_commit` checkout (§4) to detect drift.
- **`base_commit` is load-bearing.** Every analysis claim and overlap score is only valid against that commit. If the recipient builds against a different commit, the spec is re-validated and any divergence is flagged (§5).
- **`integration_contract.provides`** is the testable definition of "done": the recipient's build is acceptable only if it actually provides those symbols/signatures. This is what gets verified on merge-back.
- **`must_not_touch`** + **`required_paths`** define the editable slice; with `sandboxed_slice: true` the recipient only ever sees that slice of the repo (§7).
- The spec carries **no secrets, no Trellis-internal RLS state, no parent nodes outside the slice** — it is safe to hand across a trust boundary.

---

## 4. The delegation lifecycle

A `delegations` row (`../01-architecture/data-model.md#delegations`) tracks the handoff through the `delegation_status` enum: `draft → sent → accepted → building → returned → merged | declined`.

```
draft ──► sent ──► accepted ──► building ──► returned ──► merged
   │        │          │                                    
   └────────┴──────────┴──────────────────────────────► declined
```

| Status | Meaning | Who acts | Side effects |
|--------|---------|----------|--------------|
| **draft** | Subtree selected, spec generated, not yet handed off; delegator can still adjust the cut | delegator | spec written to `specs`; not yet visible to recipient |
| **sent** | Handed to `assigned_to_user`/`assigned_to_email` at `role` | delegator | scoped grant created (`sharing-model.md` §8); recipient notified; `delegation.sent` event |
| **accepted** | Recipient opened the spec and committed to it | recipient | recipient checks out `base_commit`; spec re-validated against their repo |
| **building** | Recipient is running/editing the mini-plan | recipient (their agents/them) | runs happen in the recipient's context; parent shows a "delegated, in progress" badge on the subtree |
| **returned** | Recipient submits results (diffs + a return manifest) back | recipient | return artifact (diffs, satisfied `provides`, recipient's revision) written; `delegation.returned` event; **does not auto-merge** |
| **merged** | Delegator/parent-editor integrated the results into the parent Plan | parent editor | integration node created/run (`../02-agent-system/integration-merge.md`); parent nodes flip to `merged` |
| **declined** | Recipient refused, or delegator withdrew | either | scoped grant revoked; spec link invalidated; subtree returns to normal parent control |

The parent Plan never blocks on a delegation: while a subtree is `building`, the rest of the parent plan keeps running. The delegated subtree's nodes show `status` reflecting the delegation, and the parent's owner can withdraw (→ `declined`) at any time.

---

## 5. Opening a portable spec as a runnable mini-plan

On the recipient side, the spec is **re-hydrated into a real (child) Plan** in the recipient's workspace — the recipient gets a normal Trellis canvas scoped to just the slice:

1. **Materialize** — `nodes`/`edges`/`annotations` become a Plan with `base_commit` set from the spec; `integration_contract.requires` render as **preconditions** at the top of the canvas; `provides` render as the **acceptance checklist** ("you owe these symbols back").
2. **Re-validate against the recipient's checkout** — the recipient's analysis service re-resolves the touch-sets against *their* `base_commit` checkout. If their checkout matches the spec's `base_commit`, resolution is clean. If not (e.g. they only have a newer commit), the engine re-runs Stages 3–6 and flags drift — exactly the `replan-and-drift.md` machinery, applied at open time.
3. **Build / edit** — the recipient operates the mini-plan like any plan: run nodes on isolated worktrees, inspect analysis, add context, replan *within the slice*. They cannot edit outside `required_paths` and are blocked from `must_not_touch` (enforced at the worktree/sandbox layer, §7).
4. **Return** — when the acceptance checklist (the `provides`) is satisfied and tests are green, the recipient hits **Return**: Trellis assembles a **return manifest** (unified diffs, the satisfied `provides` with their actual resolved signatures, the recipient's final revision, test results) and transitions the delegation `building → returned`.

The recipient never needs the parent plan, the parent's other nodes, or the parent's repo regions outside the slice — the spec is genuinely self-contained.

---

## 6. Merging results back into the parent

Return is **proposed**, not applied — merge-back is gated and goes through the integration machinery (`../02-agent-system/integration-merge.md`):

1. The parent-side delegator/editor sees the returned manifest as an **incoming integration**: an integration node is created targeting the delegated subtree's join into the parent DAG.
2. The merge agent verifies the **integration contract**: does the return actually `provide` each promised symbol with a compatible `signature`? A missing or signature-incompatible `provide` is a hard failure surfaced for adjudication — the contract is the test.
3. It attempts to apply the return's diffs onto the parent's current state, runs the **test gate**, and re-runs the dependency engine's overlap check between the returned touch-sets and any parent work that moved since `base_commit` (§7 conflict handling).
4. **Nothing auto-merges on red tests or contract violation.** On green + contract satisfied, the parent's delegated nodes flip `merged`, the delegation flips `merged`, and the cut edges become satisfied dependencies in the parent DAG.

---

## 7. Conflict & version handling when the parent moved on

The parent Plan (and its repo) can advance while a subtree is out for delegation. The spec's `base_commit` and `origin.plan_revision` are the anchors for detecting and resolving divergence:

- **Repo drift (parent commits advanced).** On return, the engine re-resolves the returned touch-sets against the parent's *current* commit. If the return's `requires`/`provides` symbols still resolve compatibly, the merge proceeds; if the parent changed a symbol the return depends on, it is flagged like any drift (`../02-agent-system/replan-and-drift.md`) and the integration node shows the conflict for adjudication.
- **Plan drift (parent replanned the boundary).** If the parent's `plan_revision` advanced *and the edits touched the delegated subtree or its cut edges*, the delegation is marked **stale**: the delegator is warned that the slice they sent no longer matches the parent. They can (a) re-export an updated spec (a new delegation revision) and ask the recipient to rebase, or (b) accept the divergence and resolve it at merge time. Edits to *unrelated* parts of the parent never staleness-flag a delegation — independence again pays off.
- **Touch-set collision on return.** If, since `base_commit`, parent work mutated a file/symbol the return also touched, the overlap check (`../02-agent-system/dependency-inference-engine.md` §5) catches it and routes the conflicting slice into the integration node's resolution UI rather than blind-applying — same false-independence safety, now across the delegation boundary.
- **Idempotent return.** A return manifest carries the recipient's revision; re-submitting the same return is a no-op (mirrors `runs.id` idempotency in `../01-architecture/data-model.md` §8).

---

## 8. Internal-user vs external handoff

| | **Internal handoff** (org member) | **External handoff** (guest / contractor / outside agent) |
|---|---|---|
| Grant | scoped delegation grant on spec + return channel (`sharing-model.md` §8) | same, but capped at the org's `max_external_role` (default `runner`) and badged external |
| Repo access | may have full repo access already; `required_paths` still scopes the mini-plan | **`sandboxed_slice: true`** — recipient is given *only* the spec's `required_paths` slice of the repo, never the whole tree; `must_not_touch` enforced at the worktree/sandbox layer (`../01-architecture/security-and-auth.md`) |
| Identity | `assigned_to_user` | usually `assigned_to_email` (claimed on first sign-in, per `sharing-model.md` §3) |
| Audit | `delegation.*` events | same, plus external badge in every event payload |
| Agent recipient | an autonomous agent in the same org runs the mini-plan | an external agent receives only the portable spec + sandboxed slice; the integration contract is its sole interface back |

Whether the recipient is a human teammate, a contractor, or an autonomous agent, the *interface is identical*: open the portable spec, build against `base_commit`, satisfy the integration contract, return. (Whether external recipients should ever get a full repo checkout vs. only a sandboxed slice is tracked in `../06-appendix/open-questions.md` — current lean: sandboxed slice for all external handoffs.)

---

## 9. Honesty constraints (consistent with the engine)

- A delegation does **not** assert the slice is conflict-free with the parent's future — it asserts it was a clean cut *at `base_commit`*, with evidence (the cut edges and their overlap scores). Divergence is detected and adjudicated on return, never silently merged.
- The integration contract is a **verifiable** definition of done, not a promise — merge-back checks it.
- Re-importing a spec re-grounds it against the recipient's real repo; baked-in `resolved` touch-sets are a starting point, not trusted blindly.

---

## To-do list

### Selection & export
- [ ] Canvas subtree selection: root pick → dependency-closed descendant closure over hard edges; cut-edge computation.
- [ ] Clean-cut check: refuse/warn on high-overlap cuts; offer split/hoist before export (reuse engine §6 strategies).
- [ ] Portable-spec serializer (`spec_version 1.0`): nodes, internal edges, frozen annotations, repo ref + `base_commit`, integration contract, checksums; write to `specs` bucket.

### Lifecycle & grants
- [ ] `delegations` lifecycle state machine (`draft→sent→accepted→building→returned→merged|declined`) + transitions/guards.
- [ ] Scoped delegation grant (spec + return channel only), internal vs external (cap + sandbox flag), email-claim path.
- [ ] Withdraw/decline → revoke grant, invalidate spec link, return subtree to parent control.

### Recipient side (mini-plan)
- [ ] Spec re-hydration into a child Plan; preconditions (`requires`) + acceptance checklist (`provides`) UI.
- [ ] Re-validate touch-sets against recipient checkout; drift detection at open time (reuse `replan-and-drift`).
- [ ] Sandboxed-slice enforcement (`required_paths` / `must_not_touch`) at worktree/sandbox layer.
- [ ] Return manifest assembly (diffs, satisfied provides + actual signatures, revision, test results).

### Merge-back
- [ ] Incoming-integration node from a returned delegation (ties to `../02-agent-system/integration-merge.md`).
- [ ] Integration-contract verification (provides present + signature-compatible) as a hard merge gate.
- [ ] Parent-moved-on handling: repo drift re-resolve, plan-drift staleness, touch-set collision → resolution UI; idempotent return.

### Audit & eval
- [ ] `delegation.*` events for every transition; activity-feed wiring (`multi-user-sync.md`).
- [ ] Eval: round-trip a delegation on a golden repo; verify contract enforcement and clean merge.

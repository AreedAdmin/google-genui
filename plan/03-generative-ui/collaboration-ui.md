# Collaboration UI — Sharing, Delegation, Presence & Activity

> Status: **Canonical.** Specifies the UI for sharing plans (viewer/runner/editor) and the "Delegate subtree" flow — selecting a subtree, previewing its portable spec, sending it, the recipient's runnable mini-plan view, assignee avatars, comments, the activity/audit feed, notifications, and re-merge-back.

This is the front-end of pillar **P3** ([scope §2, step 6](../00-overview/scope.md)). It is the UI layer over the collaboration backend and must stay consistent with [`../04-collaboration-delegation/sharing-model.md`](../04-collaboration-delegation/sharing-model.md) and [`../04-collaboration-delegation/subtree-delegation.md`](../04-collaboration-delegation/subtree-delegation.md) (the spec format, status machine, and permission semantics live there; this doc renders them). It builds on the design system ([`component-library.md`](./component-library.md)), the live behavior in [`realtime-ui.md`](./realtime-ui.md), and the per-tier delegation affordances in [`granularity-layouts.md` §2](./granularity-layouts.md). Backed by the `shares`, `delegations`, `comments`, and `events` tables ([data-model](../01-architecture/data-model.md)).

---

## 1. Roles (the permission vocabulary the UI exposes)

Three canon `share_role`s ([data-model enums](../01-architecture/data-model.md)), shown everywhere a grant is chosen with an icon + one-line description so the consequence is unambiguous (never role name alone):

| Role | Icon | Can | Cannot | UI affordances enabled |
|------|------|-----|--------|------------------------|
| **viewer** | `eye` | read the plan, nodes, analysis, diffs; comment | run, edit, delegate | read-only canvas; comments |
| **runner** | `play` | viewer + dispatch runs (node/branch/selection) | edit graph, re-plan | Run buttons, dispatch-parallel |
| **editor** | `pencil` | runner + edit nodes/edges, ratify, add context, re-plan, delegate | manage project/org membership | full editing + delegation |

RLS enforces these ([data-model §4](../01-architecture/data-model.md)); the UI **mirrors** them — actions a role lacks are hidden or disabled-with-tooltip, never shown-then-rejected.

---

## 2. Share dialog

Opened from the plan header `Share` button (`Dialog`, focus-trapped — [component-library §8](./component-library.md)).

```
┌ Share "Add OAuth login" ───────────────────────────── ✕ ┐
│ Invite                                                    │
│  ┌─────────────────────────────────┐ ┌───────────────┐   │
│  │ email or member…                │ │ ▸ runner   ▾  │   │  role picker (icon+desc)
│  └─────────────────────────────────┘ └───────────────┘   │
│                                              [ Invite ]   │
│ People with access                                        │
│  👤 you            owner                                   │
│  👤 alice@…        editor   ▾   ✕                          │
│  👤 bob@…          viewer   ▾   ✕                          │
│  🤖 build-agent    runner   ▾   ✕   (agent principal)      │
│ ─────────────────────────────────────────────────────────│
│  🔗 Link sharing: [ off ▾ ]  viewer · org-only            │
└───────────────────────────────────────────────────────────┘
```

- **Principals**: a person (member or invited email) or an **agent** (a delegated fleet runner) — both are `shares.principal_*` rows. Agents render with a robot glyph to distinguish ([granularity-layouts G4 "@bob (agent)"](./granularity-layouts.md)).
- **Per-row role** is editable inline; **remove** revokes the grant. Changes write `shares` rows and emit `events` (audit, §8) and a Realtime update so co-viewers see access change live ([realtime-ui §2](./realtime-ui.md)).
- **Link sharing** (off by default) offers `viewer`/`runner`, optionally org-restricted, per [`sharing-model.md`](../04-collaboration-delegation/sharing-model.md).
- G1 plans degrade this to **"Share diff"** ([granularity-layouts §2](./granularity-layouts.md)) — a read-only link to the single change.

---

## 3. The "Delegate subtree" flow

The headline collaboration interaction: hand a *portion* of the plan to another person or agent as a self-contained runnable unit. Four steps, all on the canvas.

```
 ① SELECT            ② PREVIEW SPEC        ③ RECIPIENT+ROLE      ④ SEND
 lasso/click a       portable spec card    pick person/agent     creates delegation,
 subtree on canvas   (what's included)     + role + base commit  notifies recipient
```

### Step 1 — Select a subtree
- The user lassos or shift-clicks a node; **"select subtree"** expands the selection to that node's dependency-closure within the plan (its descendants and required upstreams), highlighting it and dimming the rest. The selection respects branch boundaries and warns if it cuts an edge with `overlap_score > 0` (the cut would create a cross-boundary dependency — [dependency-inference-engine](../02-agent-system/dependency-inference-engine.md)).
- At G3/G4 the user can select a **whole lane or cluster** ([granularity-layouts §2](./granularity-layouts.md) per-lane / assign-clusters affordances).

### Step 2 — Preview the portable spec
Before sending, show exactly what will be handed over — the **portable spec** (the artifact format owned by [`subtree-delegation.md`](../04-collaboration-delegation/subtree-delegation.md); persisted to Storage `specs/`, referenced by `delegations.spec_path`).

```
┌ Delegate subtree · "OAuth provider wiring" ──────────────── ✕ ┐
│ Portable spec (preview)                          base: a1b2c3d │
│  Nodes (4)                                                      │
│   🔌 /auth/oauth route        api_contract   ▸ ready           │
│   🗄  oauth_accounts migration migration      ▸ ready           │
│   ⚙  providers config         config          ▸ ready           │
│   🧩 LoginButton              ui_component     ▸ ready           │
│  Edges (3) · 1 external boundary (depends on `session.ts`)     │
│  Includes: analysis, grounded touch-sets, widget specs         │
│  Excludes: rest of plan, repo write access (handoff-scoped)    │
│  ⚠ External dependency `createSession` will be provided as a    │
│     contract stub (recipient builds against the interface).     │
│                                   [ Back ]   [ Next: recipient ]│
└────────────────────────────────────────────────────────────────┘
```

- Lists the **nodes, edges, external boundaries, and base commit**; states what's included (analysis, touch-sets, widget specs) and excluded; flags external dependencies that become **contract stubs** so the recipient can build in isolation. This preview is the trust moment — the user sees the spec before anyone receives it.

### Step 3 — Recipient + role
- Choose a **person, an invited email, or an agent fleet**; pick the handoff role (`viewer` = read-only copy, `runner` = can execute, `editor` = full handoff). Set whether the result returns for **re-merge** (§7) or is informational.
- Confirms the `base_commit` the recipient builds against.

### Step 4 — Send
- Creates a `delegations` row (`status: sent`, `spec_path`, `assigned_to_*`, `role`, `base_commit`) and an `events` audit row; notifies the recipient (§9). The delegated subtree on the sender's canvas gets a **"delegated → @recipient"** badge and a muted/locked treatment (editing a delegated subtree is gated to avoid divergence; matches the status machine in [`subtree-delegation.md`](../04-collaboration-delegation/subtree-delegation.md)).

---

## 4. The recipient's view (a runnable mini-plan)

A delegated subtree opens for the recipient as a **standalone mini-plan** — the same Trellis canvas, scoped to the spec, so no new mental model.

```
┌ Delegated to you · "OAuth provider wiring"   from @you · runner ┐
│  base a1b2c3d · 4 nodes · 3 edges                               │
│  [Accept]  [Decline]                         status: sent ▸     │
├────────────────────────────────────────────────────────────────┤
│  [🗄 migration]──▶[🔌 /auth/oauth]──▶[🧩 LoginButton]            │
│                    └──▶[⚙ config] ▍independent                  │
│  ░ createSession (external) — provided as contract stub ░       │
│  [Run all ▸]   [Run branch ▸]                                   │
└────────────────────────────────────────────────────────────────┘
```

- **Accept/Decline** moves `delegation_status` (`sent → accepted | declined`), audited + notified back to the sender ([realtime-ui §2](./realtime-ui.md) live update).
- Once accepted, it's a **full Trellis plan within the recipient's permission** (role gates Run/edit per §1): inspect nodes, see grounded analysis + widgets, run on **isolated worktrees** against `base_commit` ([parallel-orchestration](../02-agent-system/parallel-orchestration.md)). External boundaries render as **contract stubs** (read-only) so the recipient builds against the interface, not the sender's in-flight code.
- Running flips `delegation_status` to `building`; diffs stream just like a normal run ([realtime-ui §6](./realtime-ui.md)).

---

## 5. Assignee avatars on branches / lanes / clusters

The visible "who owns what" layer — most prominent at G3/G4 where delegation is primary ([granularity-layouts §2](./granularity-layouts.md)).

- **Node**: assignee avatar in the node card footer ([component-library §2](./component-library.md)).
- **Branch / lane** (G3 swimlanes): an avatar (or **AvatarStack** if several) on the lane header; the lane tints faintly toward the assignee's presence color.
- **Cluster / super-node** (G4): the assignee shown on the cluster (`@alice`, `@bob (agent)`, `unassigned` — exactly the [granularity-layouts §2 G4 wireframe](./granularity-layouts.md)); clicking opens an **assign** popover (person/agent + role) that creates a delegation or a lightweight assignment.
- Avatars are sourced from `delegations.assigned_to_user` / agent principals; `unassigned` is a distinct muted state (icon + label, not just absence of color — [component-library §8](./component-library.md)).

---

## 6. Presence & comments

- **Presence** (live cursors + who's-here) is specified in [`realtime-ui.md` §7](./realtime-ui.md); this doc only consumes it — co-editors' cursors and the **edited-by** outline on a node feed the conflict UX ([realtime-ui §4](./realtime-ui.md)).
- **Comments** ([data-model comments](../01-architecture/data-model.md)): a per-node thread in the inspector. A node with comments shows a `💬 N` badge; threads support resolve/unresolve and `@mention` (which notifies, §9). Comments are durable rows → Realtime-synced ([realtime-ui §2](./realtime-ui.md)), so a thread updates live for everyone on the node.

```
inspector ▸ Comments (2)
 👤 bob   "Should config land before the route?"        [resolve]
   └ 👤 you  "Yes — edge already orders them."  ✓ resolved
 ┌ @mention or comment… ───────────────────────────┐ [Send]
```

---

## 7. Re-merge-back UI (returning a delegated subtree)

When a recipient finishes, the result comes home — the closing of the delegation loop.

- Recipient hits **"Return to sender"**: `delegation_status → returned`, packaging the produced diffs/worktree refs into the delegation result; sender is notified (§9).
- On the sender's canvas, the delegated subtree shows a **"returned · review & merge"** banner. Opening it shows the recipient's diffs per node (streamed/durable, [realtime-ui §6](./realtime-ui.md)) and a **merge preview** routed through an **Integration node** ([integration-merge](../02-agent-system/integration-merge.md), `integration_nodes` table) that checks the returned work against current base and sibling branches for conflicts.

```
┌ Returned from @bob · "OAuth provider wiring" ─── review & merge ┐
│  4 nodes built · diffs ready                                     │
│  ◆ Integration: returned subtree ⨯ current base                 │
│     ✓ no conflicts with billing branch                          │
│     ⚠ session.ts changed upstream since base a1b2c3d → re-check │
│  [Review diffs]   [Merge back ▸]   [Request changes]            │
└──────────────────────────────────────────────────────────────────┘
```

- **Merge back** runs the integration; on success `delegation_status → merged`, nodes flip to `merged` ([data-model node_status](../01-architecture/data-model.md)), and the subtree rejoins the parent plan as a new revision ([realtime-ui §5](./realtime-ui.md) re-flow). **Conflicts** surface a non-destructive conflict report ([integration-merge](../02-agent-system/integration-merge.md), [realtime-ui §4](./realtime-ui.md)) — never a silent overwrite ([scope §8](../00-overview/scope.md)). **Request changes** sends it back (`returned → building`) with comments.

---

## 8. Activity / audit feed

A reverse-chronological feed of the `events` table ([data-model events](../01-architecture/data-model.md)) — every meaningful action, the audit trail and the collaboration awareness surface in one.

```
Activity
 ⚡ alice  ran branch B                              2m ago
 🔀 you    delegated "OAuth wiring" → bob (runner)    5m ago
 ✅ bob    accepted delegation                       4m ago
 ✏  alice  ratified edge migration → route            8m ago
 💬 bob    commented on /auth/oauth route            10m ago
 ♻  system re-planned (rev 3 → 4): +2 nodes          12m ago
```

- Each row: actor (avatar; `system` for agent/engine actions), a typed verb + icon ([component-library §9](./component-library.md) icon map), target (click → focuses the node/branch on canvas), and relative time. Virtualized + live-appended via Realtime ([realtime-ui §8](./realtime-ui.md)).
- Filterable by type (runs / edits / delegations / comments / re-plans) and by actor. Doubles as the per-plan **audit log** (immutable `events` rows); a plan-level and a node-scoped view.

---

## 9. Notifications

- **In-app**: a bell with unread count; toasts ([component-library §5](./component-library.md)) for time-sensitive events (delegation received, run finished, returned-for-merge, @mention, conflict). Click → deep-links to the node/delegation.
- **Triggers** (from `events` / `delegations` status transitions): delegated-to-you, accepted/declined, returned, merged, @mentioned, share granted/revoked, run failed.
- **Out-of-app** (Phase B, customer-facing): email/Slack on high-signal events (delegation received, returned, failed), gated by per-user preferences; consistent with [`sharing-model.md`](../04-collaboration-delegation/sharing-model.md). Internal/dogfood (Phase A) is in-app only ([scope §6](../00-overview/scope.md)).
- Rate-limited per user ([data-model `ratelimit:user`](../01-architecture/data-model.md)) so a burst of run events doesn't spam.

---

## To-do list

### Sharing
- [ ] Share dialog: invite by email/member/agent, per-row role (viewer/runner/editor) with icon+desc, revoke, link-sharing toggle.
- [ ] Role-mirrored UI (hide/disable actions a role lacks; never show-then-reject); G1 "Share diff" degrade.
- [ ] `shares` writes + `events` audit + Realtime propagation of access changes.

### Delegate-subtree flow
- [ ] Subtree selection (dependency-closure expand; lane/cluster select; overlap-cut warning).
- [ ] Portable-spec preview card (nodes/edges/boundaries/base-commit, included/excluded, contract-stub flags) over [`subtree-delegation.md`](../04-collaboration-delegation/subtree-delegation.md).
- [ ] Recipient + role + return-for-merge picker; `delegations` row + audit + notify; sender-side delegated badge/lock.

### Recipient & re-merge
- [ ] Recipient mini-plan view (accept/decline, role-gated run/edit, contract stubs, isolated-worktree runs, status transitions).
- [ ] Re-merge-back: return-to-sender, returned banner, integration-node merge preview, merge/conflict/request-changes, re-flow on merge.

### Presence, comments, feed, notifications
- [ ] Assignee avatars on node/branch/lane/cluster (AvatarStack overflow; assign popover; unassigned state).
- [ ] Per-node comment threads (resolve, @mention, badge) — durable + Realtime-synced.
- [ ] Activity/audit feed from `events` (typed verbs+icons, click-to-focus, filters, virtualized, live).
- [ ] Notifications: in-app bell + toasts; triggers from events/delegation transitions; Phase-B email/Slack; per-user rate limit.

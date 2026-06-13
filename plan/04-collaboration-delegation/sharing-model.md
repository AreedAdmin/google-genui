# Sharing & Permissions

> Status: **Canonical.** Defines the role-based permission model for sharing a Plan or Project, how it is enforced by Supabase RLS, and how it interacts with subtree delegation. (Delivers **D13**.)

Sharing is the *low-ceremony* half of collaboration: grant another principal access to an existing Plan or Project at one of three roles. Delegation (`subtree-delegation.md`) is the *high-ceremony* half: cut out a portable slice and hand it off. This doc covers sharing; the two compose (see §8).

---

## 1. The three roles (`share_role`)

The permission ladder is the `share_role` enum from [`../01-architecture/data-model.md`](../01-architecture/data-model.md#1-enums): `viewer | runner | editor`. Roles are **cumulative** — `editor ⊃ runner ⊃ viewer`.

| Role | Can read | Can create `runs` | Can mutate plan structure | Typical use |
|------|----------|-------------------|---------------------------|-------------|
| **viewer** | Plan, all nodes, annotations, edges, branches, diffs, run logs, events | ✗ | ✗ | Reviewer, stakeholder, design-partner observing |
| **runner** | everything `viewer` can | ✓ run a node / branch / selection; cancel own runs | ✗ (cannot replan, edit nodes/edges, ratify) | Teammate who executes the plan you authored |
| **editor** | everything `runner` can | ✓ | ✓ replan, add/split/merge nodes, add/remove edges, **ratify** independence claims, edit annotations, manage branches | Co-author of the plan |

Notes on the boundaries (these are the load-bearing decisions):

- **viewer** sees grounded analysis, the DAG, and live updates, but the canvas is read-only: no Run, no Add-context, no ratification.
- **runner** is the "operate, don't redesign" role. A runner can click **Run** (creating a `runs` row, `kind=node_build`/`integration`) but cannot change *what* gets built. Runner respects all execution safety (locks, false-independence flags) identically to the owner.
- **editor** can replan and **ratify** — ratification (`../02-agent-system/dependency-inference-engine.md` §7) is an `editor`-only act because it relaxes the asymmetric-caution default and unlocks parallel dispatch. We deliberately gate the one action that can make parallelism *less* conservative behind the highest role.
- **Owner** is not a `share_role` value; it is `plans.created_by` / `projects.created_by`. The owner is implicitly `editor` plus the exclusive rights in §6 (manage shares, delete, transfer).

---

## 2. What you can share, and the scope of a grant

A `shares` row (see [`../01-architecture/data-model.md`](../01-architecture/data-model.md#shares)) has `resource_type ∈ {plan, project}`:

- **Plan share** — grants the role on a single Plan and everything cascaded under it (its nodes, edges, branches, annotations, runs, integration nodes, comments, events). Diffs and logs in Storage are reachable via the run/node rows the grant exposes.
- **Project share** — grants the role on the Project and **every Plan in it, present and future**. Used for "this person is on the project," not "look at this one plan." A project share does not grant repo write access on the underlying Git provider; it grants Trellis-plane access only.

A principal's **effective role** on a Plan is the **max** of: their org membership baseline, any Project share covering the Plan, and any Plan share on it. Grants only ever *add* capability; there is no per-resource "deny."

---

## 3. Who you can share with (principals)

A `shares` row carries exactly one principal:

- **By user** — `principal_user` (a `profiles.id`). Resolves immediately; the grantee sees the resource on next load and via Realtime.
- **By email** — `principal_email`, for someone who has no account yet or whom you only know by address. The grant is **pending** until that email authenticates; on first sign-in with a matching verified email, the pending `shares` rows are claimed and rewritten to `principal_user` (a Supabase Auth hook / claim step). Until claimed, the row grants nothing (RLS matches on a resolved `auth.uid()`).

### Org-internal vs external-guest sharing

- **Org-internal** — principal is a `profiles` row whose `org_id` equals the resource's `org_id`. Normal case; the grant simply extends the member's existing org-scoped visibility to this specific resource at the chosen role.
- **External guest** — principal's email is outside the org (or they have no account). Permitted but flagged: external grants are capped at the org's `max_external_role` policy (default ceiling **runner** — external guests cannot get `editor` unless an org admin lifts the cap), always recorded in `events`, and surfaced in the Plan's share panel with an "external" badge. This is the phase-B (`../00-overview/scope.md` §6) customer-facing safety bar made concrete. External guests **never** inherit a Project share's "future plans" breadth — external project shares are rejected; share the specific Plan instead.

---

## 4. Link sharing

For low-friction read access we support a **share link**: a signed, capability-bearing URL that maps to a `shares` row with `principal_user = NULL AND principal_email = NULL` and an added `link_token` (hashed at rest). Constraints, because an unauthenticated capability URL is the riskiest surface:

- **viewer-only by default.** `runner`/`editor` link sharing is gated behind org policy and forces sign-in (a link can grant ≤ `runner`; never `editor`).
- **Expiry + revocable.** Every link has an expiry; revoking deletes the `shares` row and invalidates the token immediately.
- **Sign-in-to-act.** A link `viewer` who needs to act must authenticate and be re-granted by a principal grant; link tokens never write data.
- **Org-external links** obey the §3 external cap and the org's "allow link sharing" toggle (off for orgs with a strict bar).

---

## 5. Enforcement (Supabase RLS)

Every rule here is enforced at the database, not just the UI — the UI merely *reflects* the role. Full policy text lives in [`../01-architecture/security-and-auth.md`](../01-architecture/security-and-auth.md); the model:

- **Default deny.** A row in any plan-scoped table is visible only if the caller is org-member-with-project-access **or** an applicable `shares`/`delegations` grant exists, per [`../01-architecture/data-model.md`](../01-architecture/data-model.md#4-row-level-security-summary-full-policy-in-security-and-authmd).
- **Read** policies join the target row → its `plan_id`/`project_id` → the caller's effective grants; effective role ≥ `viewer` ⇒ `SELECT` allowed.
- **Run** policies: an `INSERT` into `runs` requires effective role ≥ `runner` on the run's `plan_id`.
- **Write** policies: `INSERT/UPDATE/DELETE` on `plan_nodes`, `plan_edges`, `branches`, `node_annotations`, `plan_revisions`, and ratification fields require effective role ≥ `editor`.
- **Managing shares** (writing `shares` rows) requires owner/admin (§6) — a grantee cannot re-share above their own role, and cannot grant at all unless explicitly an owner.
- **Service-role workers** bypass RLS but must scope every query by `plan_id`/`project_id` and stamp the acting principal into `events` (no anonymous mutations).

A helper SQL function `effective_role(uid, plan_id) -> share_role` centralizes the max-of-grants computation so every policy reads the same definition.

---

## 6. Owner-exclusive rights & revocation

Only the owner (or an org admin) may: manage `shares` (grant/modify/revoke), create link shares, change a Plan's external policy exceptions, delete/archive the Plan, and transfer ownership.

**Revocation** is immediate and complete:

- Deleting a `shares` row removes the grant; RLS denies the next request. Open Realtime subscriptions are torn down because the channel's RLS check re-runs on each change (a revoked viewer stops receiving updates).
- Revoking a link deletes its row and invalidates `link_token`.
- Revocation does **not** retroactively rewrite history: runs the grantee already created, comments they wrote, and `events` they generated remain (attributed to them) — revocation removes *future* capability, not the audit trail.
- Revoking access for a principal who holds an **open delegation** is handled in §8.

---

## 7. Audit via `events`

Every sharing action writes an `events` row (`../01-architecture/data-model.md#events`) with `actor`, `type`, and a `payload`:

- `share.granted` / `share.role_changed` / `share.revoked` (`payload`: principal, role, resource_type, external bool)
- `share.link_created` / `share.link_revoked`
- `share.claimed` (a pending email grant resolved to a user)
- Role-gated *attempts* that RLS denied are logged as `share.denied` (helps debug "why can't they see it?")

The Plan's activity feed (`multi-user-sync.md` §6) renders these alongside edit/run events, giving a single chronological audit of who-did-what. Events are append-only and outlive revocation.

---

## 8. Interaction with delegation

Sharing and delegation are distinct grants over different scopes, and they compose:

- **A delegation implies a scoped share on its slice.** When a `delegations` row is `sent` to a principal (`subtree-delegation.md` §3), the recipient gets effective access **only to the delegated subtree's portable spec and its return channel** — not the whole parent Plan. Mechanically the delegation grant is narrower than a Plan share: it exposes the spec artifact in the `specs` bucket and the delegation row, at the delegation's `role`, and nothing else of the parent.
- **A Plan share is broader but does not auto-create delegations.** Giving someone `editor` on a Plan lets them *create* delegations from it (delegation creation requires ≥ `editor`, since it cuts structure), but it does not itself delegate anything.
- **Role ceilings stack.** A delegation's `role` may not exceed what the delegator could grant; external-guest delegations obey the §3 cap.
- **Revocation interplay.** Revoking a Plan share from a user who holds an active delegation on a subtree does **not** revoke the delegation (it has its own grant and lifecycle); revoke the delegation explicitly (sets `status=declined`/withdrawn, invalidates the spec link). Conversely, declining/withdrawing a delegation does not touch any independent Plan share the principal holds.
- **Merge-back requires write on the parent.** When a recipient returns built results, applying them to the parent Plan is an `editor`-level act performed by (or approved by) someone with `editor` on the parent — the recipient's delegation grant lets them *return*, not *merge into the parent* (`subtree-delegation.md` §4, `../02-agent-system/integration-merge.md`).

---

## 9. Edge cases & guarantees

- **No privilege escalation via re-share:** a grantee cannot grant a role above their own, and only owners grant at all.
- **Granularity of visibility is the Plan, not the node:** there is no per-node ACL in v1. To hand off a *part* of a plan with restricted scope, use **subtree delegation**, which is the intentional mechanism for partial sharing.
- **Project share + external principal** is rejected at the API and RLS layer (external guests get Plan-scoped grants only).
- **Stale pending email grants** expire on the same schedule as link shares; an unclaimed email grant past expiry is garbage-collected and logged.

---

## To-do list

### Schema & RLS
- [ ] Add `link_token` (hashed) + `expires_at` to `shares`; migration + index on `(resource_type, resource_id)`.
- [ ] Implement `effective_role(uid, plan_id)` SQL function (max of org baseline + project share + plan share).
- [ ] RLS policies: read (≥viewer), run-insert (≥runner), structural writes + ratification (≥editor), share-management (owner/admin).
- [ ] External-guest cap (`max_external_role`) + reject external Project shares.

### Claim & link flows
- [ ] Pending email-grant claim on first verified sign-in (Auth hook) → rewrite to `principal_user`; emit `share.claimed`.
- [ ] Signed share-link issuance/verification; viewer-default; expiry; revocation invalidates token.

### App & API
- [ ] Share panel UI: by-user / by-email invite, role picker, external badge, link toggle, revoke (ties to `../03-generative-ui/collaboration-ui.md`).
- [ ] API: grant / change-role / revoke / create-link / revoke-link, all owner-gated.
- [ ] Re-share ceiling enforcement (cannot grant above own role).

### Audit & delegation interplay
- [ ] Emit `share.*` events for every action incl. RLS `share.denied`.
- [ ] Wire share events into the Plan activity feed (`multi-user-sync.md`).
- [ ] Scoped delegation grant (spec + return channel only) distinct from Plan share; revocation interplay tests.

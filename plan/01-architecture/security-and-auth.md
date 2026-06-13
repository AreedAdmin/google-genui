# Security & Auth

> Status: **Canonical.** Defines authentication (Supabase Auth + GitHub OAuth), the org/role model, the full RLS policy approach with example policies, the service-role worker pattern, and the central hard problem — **sandboxed execution of agent-generated code** — plus secrets management, audit logging, and rate/cost limiting.

This doc enforces [ADR-1 (ratified hypothesis — never auto-run unratified in customer mode)](./high-level-architecture.md) and [ADR-5 (validated, not raw, generated UI)](./high-level-architecture.md). It uses the tables, enums, and Redis keys from [data-model.md](./data-model.md), the role model from [data-model.md §4](./data-model.md), and aligns the trust bars with the [audience phasing in scope.md §6](../00-overview/scope.md).

---

## 1. Authentication (Supabase Auth)

> **First-draft scope (v1):** auth is intentionally minimal — **email + password** *or* **GitHub OAuth**, nothing else. **No OTP / magic-link, no MFA/2FA, no SSO/SAML, no password-reset-by-code flows** in the first draft. These are deferred to the customer-facing hardening phase (Phase B, [scope.md §6](../00-overview/scope.md)) and tracked as a v1 simplification, not a security stance for production-customer use. Everything downstream of authentication (the org/role model, RLS, sandboxing, secrets) is unchanged — only the set of sign-in *methods* is reduced.

- **Methods (v1):** **email + password** and **GitHub OAuth**. GitHub OAuth is dual-purpose: it authenticates the user **and** grants the repo-access scope used to clone/index private repositories ([scope.md §4](../00-overview/scope.md)).
- **Deferred to Phase B:** magic-link/OTP, MFA/TOTP, SSO/SAML, email-verification gating. (Supabase Auth supports these natively, so enabling them later is config, not re-architecture.)
- **Session:** Supabase issues a JWT carrying `sub` (= `profiles.id`), `org_id`, and role claims. The web app holds the session via the Supabase JS client; the API verifies the JWT and **forwards it to Postgres** so RLS evaluates on every read ([api-design.md §0](./api-design.md)).
- **GitHub token storage:** the GitHub OAuth access/refresh token lives in the Supabase Auth `identities` store (encrypted at rest), **never** in our domain tables. Workers fetch a short-lived installation/user token at clone time via the secrets broker (§9), use it for `git clone`/`fetch`, and discard it — the token never enters a worktree, an agent prompt, or a log.
- **Org provisioning:** a new sign-up creates a `profiles` row (1:1 with `auth.users`) bound to an `organizations` row; `profiles.default_role` seeds their org membership role.

---

## 2. Orgs, roles, and grants

Two role sources combine into an **effective role** per resource:

1. **Org membership** — `profiles.org_id` + `default_role` (e.g. `org_admin`, `editor`, `member`).
2. **Explicit grants** — `shares` (per plan/project) and `delegations` (per subtree), each carrying a `share_role` of `viewer | runner | editor` ([data-model.md §1](./data-model.md)).

| Role | Can | Maps to |
|------|-----|---------|
| `viewer` | read plan/nodes/edges/annotations; comment; vote feedback | `shares.role=viewer`, delegation viewer |
| `runner` | everything `viewer` + create `runs` (run node/branch/selection/integrate) | `shares.role=runner` |
| `editor` | everything `runner` + mutate nodes/edges, replan, delegate, manage shares | `shares.role=editor`, org `editor` |
| `org_admin` | everything `editor` across the org + manage members/projects/billing | org membership |

Effective role = **max** of org-derived and grant-derived roles, scoped to the resource. A delegation grant is narrower than a plan share: it grants the chosen role **only on the delegated subtree's spec**, not the whole plan.

---

## 3. Row-Level Security (RLS)

**Default deny.** Every domain table has RLS enabled; a row is visible only when the caller's org matches **and** (org-member-with-project-access **or** an explicit `shares`/`delegations` grant exists), per [data-model.md §4](./data-model.md). Writes additionally require the effective role for the action.

### Helper predicates (SQL functions)

```sql
-- caller's org from JWT
create function auth_org() returns uuid language sql stable as
  $$ select (auth.jwt() ->> 'org_id')::uuid $$;

-- does caller have at least `min_role` on a plan (org access OR share grant)?
create function can_access_plan(p_plan uuid, min_role share_role)
returns boolean language sql stable as $$
  select exists (
    select 1 from plans pl
    join projects pr on pr.id = pl.project_id
    where pl.id = p_plan
      and pr.org_id = auth_org()
      and (
        -- org member with project access
        exists (select 1 from profiles me where me.id = auth.uid() and me.org_id = pr.org_id)
        -- OR an explicit share grant of sufficient role
        or exists (
          select 1 from shares s
          where s.resource_id = pl.id and s.resource_type = 'plan'
            and (s.principal_user = auth.uid()
                 or s.principal_email = (auth.jwt() ->> 'email'))
            and role_rank(s.role) >= role_rank(min_role)
        )
        -- OR a delegation grant on a subtree of this plan
        or exists (
          select 1 from delegations d
          where d.plan_id = pl.id
            and (d.assigned_to_user = auth.uid()
                 or d.assigned_to_email = (auth.jwt() ->> 'email'))
            and role_rank(d.role) >= role_rank(min_role)
        )
      )
  );
$$;
-- role_rank: viewer=1, runner=2, editor=3
```

### Example policies

```sql
-- plans: read with viewer, write with editor
alter table plans enable row level security;

create policy plans_select on plans for select
  using ( can_access_plan(id, 'viewer') );

create policy plans_update on plans for update
  using      ( can_access_plan(id, 'editor') )
  with check ( can_access_plan(id, 'editor') );

-- plan_nodes: inherit access from the parent plan
create policy nodes_select on plan_nodes for select
  using ( can_access_plan(plan_id, 'viewer') );
create policy nodes_write on plan_nodes for all
  using      ( can_access_plan(plan_id, 'editor') )
  with check ( can_access_plan(plan_id, 'editor') );

-- runs: read with viewer, create with runner
create policy runs_select on runs for select
  using ( can_access_plan(plan_id, 'viewer') );
create policy runs_insert on runs for insert
  with check ( can_access_plan(plan_id, 'runner') );

-- delegations: creator (editor) OR the assignee may see; only editor may create
create policy delegations_select on delegations for select
  using ( can_access_plan(plan_id, 'editor')
          or assigned_to_user = auth.uid()
          or assigned_to_email = (auth.jwt() ->> 'email') );
create policy delegations_insert on delegations for insert
  with check ( can_access_plan(plan_id, 'editor') );

-- shares: only an editor on the resource may grant; principals may read their own grant
create policy shares_insert on shares for insert
  with check ( can_access_plan(resource_id, 'editor') );  -- (plan resources)
create policy shares_select on shares for select
  using ( created_by = auth.uid()
          or principal_user = auth.uid()
          or principal_email = (auth.jwt() ->> 'email') );
```

`node_annotations`, `plan_edges`, `branches`, `comments`, `feedback`, `integration_nodes`, `events` all follow the **inherit-from-plan** pattern (`can_access_plan(plan_id, …)`). Storage buckets (`diffs`, `logs`, `specs`, `repo-index`) use Storage RLS policies keyed on the same predicates so a signed URL is only issued to an authorized caller.

### Realtime under RLS

Supabase Realtime applies the same policies: a subscriber to `plan:{id}` / `runs:{plan_id}` only receives rows it could `SELECT`. There is no separate broadcast authorization to maintain — RLS is the single gate ([api-design.md §13](./api-design.md)).

### Service-role (worker) access pattern

Workers run with the **service-role key**, which bypasses RLS ([data-model.md §4](./data-model.md)). To keep this safe:

- Workers **always scope every query explicitly** by `plan_id`/`project_id` from the job payload — they never run an unscoped query.
- The service-role key is loaded only into worker containers (never the web app, never the browser), from the secrets broker (§9).
- Workers verify the job's authorization context at enqueue time (the API already checked the caller's role before enqueueing); the worker re-asserts the `plan_id`/`org_id` it was handed and refuses cross-org file paths.
- Every service-role mutation writes an `events` row (§8) so the bypass is auditable.

---

## 4. Sandboxed code execution (the hard problem)

Builder agents (Sonnet) generate and **run** code — installing dependencies, running tests, executing build steps. This is partially-untrusted execution: the *repo* may be a customer's, the *generated code* is model output, and the *dependency tree* is third-party. The threat model is **exfiltration** (secrets, source, tokens leaving), **lateral movement** (one tenant's run touching another's data), and **resource abuse** (crypto-mining, fork bombs). Defense is **physical isolation + least privilege + no egress**, not trust in the model.

### 4.1 Isolation topology

```
   node-run job
        │
        ▼
 ┌────────────────────────────────────────────────────────────┐
 │  EPHEMERAL SANDBOX (one per run)                            │
 │  · container (gVisor / Firecracker microVM)                 │
 │  · ephemeral git worktree on a tmpfs/overlay (ADR-3)        │
 │  · non-root user, read-only base image, writable worktree   │
 │  · seccomp + dropped capabilities; no host mounts           │
 │  · NETWORK: deny-all egress except an allow-listed          │
 │            package proxy + the Claude API egress proxy      │
 │  · CPU/mem/pids/disk caps; wall-clock timeout               │
 │  · destroyed on run terminal state (succeeded/failed/cancel)│
 └────────────────────────────────────────────────────────────┘
```

- **One sandbox per run, ephemeral.** Created on job pickup, destroyed on terminal state. No sandbox is reused across runs or tenants — a compromised run cannot persist or observe a sibling. This pairs with the [worktree-per-branch isolation (ADR-3)](./high-level-architecture.md): each branch's build gets its own worktree, and the file-overlap `lock:file` backstop ([realtime-and-state.md §4](./realtime-and-state.md)) ensures two sandboxes never write the same path.
- **Container runtime:** gVisor (syscall interception) or Firecracker microVMs for stronger kernel isolation in the customer-facing tier. Non-root, read-only root FS, **all** Linux capabilities dropped except the minimal set, seccomp-bpf syscall allow-list, no privileged mode, no host bind-mounts.

### 4.2 Network posture (no exfiltration)

- **Deny-all egress by default.** The sandbox has **no** route to the internet, to other tenants, to Redis, to Postgres, or to internal services.
- **Two narrow allow-listed proxies only:**
  1. A **package proxy** (pinned mirror) for `npm`/`pip` installs — allow-listed registries only, with checksum verification.
  2. The **Claude egress proxy** — the worker (not the sandbox) holds the Anthropic key and brokers tool calls; the sandbox executes file/test tools and never sees the API key.
- Result: even if generated code is malicious, it **cannot dial out** to exfiltrate source or secrets — there is nowhere to send them.

### 4.3 Resource caps & timeouts

CPU shares, memory limit (OOM-kill on breach), `pids` limit (anti fork-bomb), disk quota on the worktree tmpfs, and a **wall-clock timeout** per run. On any breach the sandbox is killed, the run transitions to `failed` with a clear reason on `stream:run:{id}`, and the job is **not** blindly retried (a resource-exhausting build is unlikely to differ on retry). Per-org concurrency caps bound how many sandboxes an org can run at once, enforced via `ratelimit:org:{id}` (§10).

### 4.4 Secret handling inside the sandbox

- **No long-lived secrets ever enter a sandbox.** The GitHub token is used by the **worker** to clone, then the worktree is handed to the sandbox **without** credentials (the `.git/config` credential helper is stripped).
- The Anthropic API key stays in the worker process behind the egress proxy.
- Service-role keys, the DB connection string, and Redis credentials are worker-only and never mounted into a sandbox.
- Generated diffs are scanned for accidentally-committed secrets (detect-secrets / gitleaks pattern) before they surface to the user or merge.

### 4.5 Supply-chain considerations

- **Pinned, mirrored dependencies:** installs go through the package proxy against pinned versions/lockfiles; no arbitrary registry, no `postinstall` network access (egress is denied anyway).
- **Base images** are minimal, pinned by digest, and rebuilt/scanned on a schedule; SBOM tracked.
- **Lockfile diffing:** if a build would add/upgrade a dependency, that change surfaces in the diff for ratification rather than being silently merged ([ADR-1](./high-level-architecture.md)).
- **No execution of the repo's own scripts on index:** the Python analysis service parses with tree-sitter statically and **never** executes target-repo code ([dependency-inference-engine.md](../02-agent-system/dependency-inference-engine.md)) — only the Builder sandbox runs code, and only under the controls above.

### 4.6 Trust bars: internal vs customer-facing

Aligned with [scope.md §6 phasing](../00-overview/scope.md):

| Control | Phase A — internal/dogfood | Phase B — customer-facing |
|---------|----------------------------|---------------------------|
| Isolation | container (gVisor) | microVM (Firecracker) or hardened gVisor |
| Egress | allow-list proxies | allow-list proxies **+ per-tenant egress policy** |
| Ratification | may auto-run high-confidence branches internally | **never** auto-run unratified plans ([ADR-1](./high-level-architecture.md)) |
| Secret scanning | on merge | on diff surface **and** merge |
| Tenancy | shared-pool sandboxes acceptable | strict per-tenant sandbox isolation; no cross-tenant pool |
| Audit | events table | events + exported audit log + retention SLA |

---

## 5. Generated-UI safety

Per [ADR-5](./high-level-architecture.md): the model emits **widget/layout specs** validated against a component registry (zod), stored in `node_annotations.widget_specs` ([data-model.md §5](./data-model.md)). The client renders **only** registered widgets with validated props — **never** raw model HTML/JS — eliminating an XSS/prompt-injection rendering surface.

---

## 6. Audit logging

The **`events`** table is the audit log ([data-model.md §1](./data-model.md)): `{ id, plan_id, actor, type, payload, created_at }`. Every consequential action writes an event — plan created/replanned, node run/cancel, branch ratified, integration merged/conflicted, delegation sent/accepted/returned, share granted/revoked, **and every service-role mutation** (§3). Events fan out on the `events:{plan_id}` Realtime channel (the activity feed) and are retained for the audit window. Auth events (sign-in, OAuth grant, token refresh) come from Supabase Auth's own audit stream and are correlated by `actor`.

---

## 7. Secrets management

| Secret | Where it lives | Never in |
|--------|----------------|----------|
| GitHub OAuth token | Supabase Auth `identities` (encrypted) | domain tables, prompts, logs, sandboxes |
| Anthropic API key | worker env via secrets broker | web app, browser, sandbox |
| Supabase service-role key | worker env via secrets broker | web app, browser, sandbox |
| DB / Redis connection strings | worker + API env via secrets broker | sandbox |
| Storage signing keys | API env | client (only signed URLs leave) |

- A **secrets broker** (managed secrets manager) injects secrets into API/worker containers at runtime; nothing sensitive is baked into images or committed.
- Rotation is supported (short-lived GitHub tokens; rotatable service-role/API keys).
- Logs and prompts are **scrubbed** of token-shaped strings before persistence/streaming.

---

## 8. Rate & cost limiting

Enforced via the Redis token buckets `ratelimit:org:{id}` / `ratelimit:user:{id}` ([data-model.md §6](./data-model.md)):

- **API rate limiting:** per-user and per-org request buckets; breach → `429 rate_limited` with `Retry-After` ([api-design.md §9](./api-design.md)).
- **Cost guards (LLM):** each `runs` row records `tokens` + `cost`; per-org/per-plan spend is metered against a budget bucket. Approaching the cap throttles new `plan-build`/`node-run`/`replan` dispatch (queued, not dropped); exceeding it blocks new runs with a clear, surfaced reason. PostHog tracks LLM cost per org/model for billing and alerting ([deployment-and-infra.md](./deployment-and-infra.md)).
- **Concurrency caps:** max simultaneous sandboxes per org (§4.3) bound resource abuse independent of request rate.

---

## To-do list

- [ ] Wire Supabase Auth (v1): **email + password** and **GitHub OAuth** (repo scope) only — no OTP/magic-link/MFA/SSO; provision `profiles`/`organizations` on sign-up.
- [ ] (Phase B) Enable deferred auth methods via Supabase config: magic-link/OTP, MFA/TOTP, SSO/SAML, email-verification gating.
- [ ] Store/rotate GitHub tokens in Auth `identities`; broker short-lived clone tokens to workers; strip credentials from worktrees.
- [ ] Implement `role_rank`, `auth_org`, `can_access_plan` SQL helpers and enable RLS on every domain table.
- [ ] Author RLS policies for plans/nodes/edges/branches/runs/annotations/delegations/shares/comments/feedback/events (inherit-from-plan).
- [ ] Add Storage RLS policies for `diffs`/`logs`/`specs`/`repo-index` buckets; issue signed URLs only to authorized callers.
- [ ] Implement the service-role worker pattern: explicit `plan_id`/`project_id` scoping + cross-org refusal + event on every mutation.
- [ ] Build the ephemeral sandbox runner (gVisor/Firecracker), non-root, read-only base, seccomp, dropped caps, deny-all egress.
- [ ] Stand up the package proxy (pinned mirror, checksum) and Claude egress proxy; keep keys out of the sandbox.
- [ ] Enforce CPU/mem/pids/disk/wall-clock caps + per-org sandbox concurrency; clean reason on breach.
- [ ] Add diff secret-scanning (gitleaks/detect-secrets) on surface and on merge; surface dependency/lockfile changes for ratification.
- [ ] Pin base images by digest, generate SBOM, schedule rebuild/scan.
- [ ] Implement the `events` audit log writes across all consequential actions + the `events:{plan_id}` feed.
- [ ] Integrate the secrets broker; scrub token-shaped strings from logs/prompts.
- [ ] Implement `ratelimit:org|user` token buckets for API rate limiting and LLM cost guards; emit cost metrics to PostHog.
- [ ] Document and enforce the Phase A vs Phase B trust-bar differences in deploy config.

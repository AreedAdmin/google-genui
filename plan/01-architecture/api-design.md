# API Design — Orchestration REST Surface

> Status: **Canonical.** The complete REST surface of the Fastify orchestration API — every endpoint behind the core flows, with method/path/body/response/auth/side-effects — plus the error model, idempotency, pagination, versioning, and the Supabase Realtime channels the client subscribes to.

This doc is the contract between the [web app](./high-level-architecture.md) and the [orchestration API](./tech-stack.md). It uses the entity and field names from [data-model.md](./data-model.md) verbatim, enqueues the BullMQ queues and acquires the Redis locks defined there, and implements the flows in [high-level-architecture.md §3](./high-level-architecture.md). The API **never** runs agent loops inline — it validates, persists, enqueues, and returns; the long work happens in [workers](../02-agent-system/parallel-orchestration.md) and streams back over [realtime](./realtime-and-state.md).

---

## 0. Conventions

- **Base:** `https://api.trellis.dev`. All routes are under `/v1` (see [§9 Versioning](#9-versioning)).
- **Format:** JSON in/out; `Content-Type: application/json`; UTF-8. Timestamps are RFC 3339 / `timestamptz`.
- **IDs:** all resource IDs are `uuid` (matching `data-model.md` PKs). Client-supplied IDs (e.g. `run_id`) must be v4 UUIDs.
- **Validation:** every body is validated with **zod**; a violation returns `422` with field paths (see [§7](#7-error-model)).
- **Auth:** `Authorization: Bearer <supabase-jwt>`. The JWT carries `sub` (= `profiles.id`), `org_id`, and role claims. The API forwards the JWT to Postgres so **RLS applies on every read** (see [security-and-auth.md](./security-and-auth.md)); writes are checked against the caller's effective role on the resource.
- **Roles** (from `share_role` + org membership): `viewer` < `runner` < `editor` < `org_admin`. Each endpoint lists the **minimum** role. A `runner` may create `runs`; an `editor` may mutate nodes/edges/replan; a `viewer` is read-only ([data-model.md §4](./data-model.md)).
- **Idempotency:** all run-creating endpoints accept a client-generated `run_id`; replay is a no-op (see [§8](#8-idempotency--concurrency)).
- **Side-effects column:** lists the BullMQ **queue** enqueued (`queue:*`) and the Redis **locks** acquired (`lock:*`), both per [data-model.md §6](./data-model.md).

---

## 1. Endpoint index

| # | Method | Path | Min role | Queue | Locks |
|---|--------|------|----------|-------|-------|
| Projects | `POST` | `/projects` | editor | — | — |
| | `GET` | `/projects/:id` | viewer | — | — |
| | `POST` | `/projects/:id/index` | editor | — | — |
| Plans | `POST` | `/plans` | editor | `plan-build` | `lock:plan` |
| | `GET` | `/plans/:id` | viewer | — | — |
| | `GET` | `/plans` | viewer | — | — |
| | `PATCH` | `/plans/:id` | editor | — | — |
| | `POST` | `/plans/:id/replan` | editor | `replan` | `lock:plan` |
| | `GET` | `/plans/:id/revisions` | viewer | — | — |
| | `GET` | `/plans/:id/revisions/:rev` | viewer | — | — |
| | `DELETE` | `/plans/:id` | editor | — | — |
| Nodes | `GET` | `/nodes/:id` | viewer | — | — |
| | `PATCH` | `/nodes/:id` | editor | — | `lock:node` |
| | `POST` | `/nodes/:id/run` | runner | `node-run` | `lock:node`, `lock:file` |
| | `POST` | `/nodes/:id/split` | editor | `replan` | `lock:node` |
| | `POST` | `/nodes/:id/cancel` | runner | — | — |
| Edges | `POST` | `/plans/:id/edges` | editor | — | `lock:plan` |
| | `DELETE` | `/edges/:id` | editor | — | `lock:plan` |
| Branches | `GET` | `/branches/:id` | viewer | — | — |
| | `POST` | `/branches/:id/ratify` | editor | — | — |
| | `POST` | `/branches/:id/run` | runner | `node-run` | `lock:branch`, `lock:file` |
| Selection | `POST` | `/plans/:id/run-selection` | runner | `node-run` | `lock:node`, `lock:file` |
| Integration | `POST` | `/plans/:id/integrate` | runner | `integration` | `lock:branch` |
| | `GET` | `/integration-nodes/:id` | viewer | — | — |
| Delegation | `POST` | `/plans/:id/delegate` | editor | — | — |
| | `GET` | `/delegations/:id` | viewer | — | — |
| | `POST` | `/delegations/:id/accept` | runner | — | — |
| | `POST` | `/delegations/:id/return` | editor | `integration` | `lock:plan` |
| Export | `GET` | `/plans/:id/export` | viewer | — | — |
| Shares | `POST` | `/shares` | editor | — | — |
| | `GET` | `/shares?resource_id=` | viewer | — | — |
| | `DELETE` | `/shares/:id` | editor | — | — |
| Comments | `POST` | `/nodes/:id/comments` | viewer | — | — |
| | `GET` | `/nodes/:id/comments` | viewer | — | — |
| | `PATCH` | `/comments/:id` | viewer¹ | — | — |
| Feedback | `POST` | `/nodes/:id/feedback` | viewer | — | — |
| Runs | `GET` | `/runs/:id` | viewer | — | — |
| | `GET` | `/runs/:id/logs` | viewer | — | — |
| | `GET` | `/plans/:id/runs` | viewer | — | — |

¹ A `viewer` may resolve/edit only their own comment; `editor` may resolve any.

---

## 2. Projects & indexing

### `POST /projects`
Connect a repository. Creates a `projects` row.
- **Body:** `{ "name": str, "repo_url": str, "provider": "github"|"upload", "default_branch": str, "languages": str[] }`
- **Response `201`:** the `projects` row.
- **Side-effects:** none synchronous. For `provider:"github"`, the caller's GitHub OAuth token (from Supabase Auth identities, see [security-and-auth.md](./security-and-auth.md)) authorizes the clone; the first index is triggered by `POST /projects/:id/index`.

### `POST /projects/:id/index`
Index (or re-index) a commit into `repo_index`. Calls the [Python analysis service](../02-agent-system/dependency-inference-engine.md) `POST /index`.
- **Body:** `{ "commit_sha"?: str }` (defaults to `default_branch` HEAD).
- **Response `202`:** `{ "repo_index_id": uuid, "commit_sha": str, "status": "indexing" }`.
- **Side-effects:** populates `cache:symbolgraph:{project}:{commit}`; writes a `repo_index` row + `repo-index` Storage artifacts on completion. Idempotent per `(project, commit)` — a hot cache hit returns the existing row.

---

## 3. Plans

### `POST /plans`  — *Flow A (Create a plan)*
Create a plan from intent and kick off planning. Implements [Flow A](./high-level-architecture.md).
- **Body:**
  ```jsonc
  {
    "project_id": "uuid",
    "prompt": "add OAuth login",
    "title": "OAuth login",          // optional; planner fills if absent
    "granularity": "g2_meso",        // optional override; else detected
    "base_commit": "abc123"          // optional; else default_branch HEAD
  }
  ```
- **Response `201`:** the `plans` row with `status: "planning"`, `current_revision: 1`.
- **Auth:** `editor` on the project.
- **Side-effects:** persists `plans(status=draft→planning)`; acquires `lock:plan:{id}`; enqueues **`queue:plan-build`** with `{ plan_id, run_id }`. The worker runs Planner → Dependency-Inference → persists `plan_nodes`/`plan_edges`/`branches`, then enqueues `queue:analysis` per node. Progress arrives over the `plan:{id}` Realtime channel ([§10](#10-realtime-channels)).

### `GET /plans/:id`
Fetch a plan with its full graph for a given revision.
- **Query:** `?revision=` (default: `current_revision`), `?include=nodes,edges,branches,annotations,integration_nodes` (default: all).
- **Response `200`:**
  ```jsonc
  {
    "plan": { /* plans row */ },
    "nodes": [ /* plan_nodes for revision, incl. touch_set, status, branch_id, confidence */ ],
    "edges": [ /* plan_edges for revision, incl. type, evidence, overlap_score */ ],
    "branches": [ /* branches incl. node_ids, status, independent_of */ ],
    "annotations": [ /* node_annotations for revision (may be partial while streaming) */ ],
    "integration_nodes": [ /* ... */ ]
  }
  ```
- **Auth:** `viewer` (RLS-scoped: org member with project access **or** a `shares`/`delegations` grant).
- **Note:** annotations may be `null`/partial during initial plan-build; the client fills them via the `plan:{id}` channel.

### `GET /plans`
List plans visible to the caller.
- **Query:** `?project_id=`, `?status=`, `?cursor=`, `?limit=` (pagination, [§6](#6-pagination)).
- **Response `200`:** `{ "data": [ /* plan summaries */ ], "next_cursor": str|null }`.

### `PATCH /plans/:id`
Edit plan metadata (`title`, user-overridden `granularity`, `status` transitions limited to user-allowed ones e.g. `ready`, `archived`).
- **Body:** partial `{ title?, granularity?, status? }`. Status transitions are validated against the [plan_status state machine](./realtime-and-state.md).
- **Response `200`:** updated `plans` row. **Side-effects:** emits an `events` row + `plan:{id}` update.

### `POST /plans/:id/replan`  — *Flow C (Iterate / re-plan)*
Re-flow the plan with added context. Implements [Flow C](./high-level-architecture.md).
- **Body:** `{ "context": str, "scope_node_ids"?: uuid[], "run_id": uuid }`.
- **Response `202`:** `{ "run_id": uuid, "revision": int }` (the **new** revision number).
- **Auth:** `editor`.
- **Side-effects:** acquires `lock:plan:{id}`; enqueues **`queue:replan`** with `{ plan_id, run_id, context, scope_node_ids }`. The Replan worker writes a `plan_revisions` row, re-derives dependencies **incrementally** on changed touch-sets only, bumps `plans.current_revision`, and emits a diffable revision over `plan:{id}`.

### `GET /plans/:id/revisions` · `GET /plans/:id/revisions/:rev`
List revisions (`plan_revisions`) / fetch one revision's `diff` jsonb for the canvas revision-diff view.
- **Response `200`:** list / single `plan_revisions` row.

### `DELETE /plans/:id`
Archive a plan (soft: sets `status:"archived"`; FK `on delete cascade` means a hard delete also drops nodes/edges/branches/runs/annotations — default is soft archive).
- **Auth:** `editor`. **Response `204`.**

---

## 4. Nodes, edges, branches

### `GET /nodes/:id`
Fetch one node with its `node_annotations` (the five P2 sections) and resolved `touch_set`.
- **Response `200`:** `{ "node": { /* plan_nodes */ }, "annotation": { /* node_annotations */ }, "comments_count": int }`.

### `PATCH /nodes/:id`
Edit a node (`title`, `summary`, `change_type`, manual `branch_id` reassignment, `position`).
- **Body:** partial. Editing `touch_set` semantically is **not** allowed here (that is the engine's job); `position` updates are layout-cache only and do **not** bump revision.
- **Side-effects:** acquires `lock:node:{id}` for non-position edits; emits `node:update` on `plan:{id}`.

### `POST /nodes/:id/run`  — *single-node execution*
Build one node on an isolated worktree.
- **Body:** `{ "run_id": uuid, "model"?: "sonnet-4.6" }`.
- **Response `202`:** the created `runs` row (`kind:"node_build"`, `status:"queued"`, `logs_stream_key:"stream:run:{run_id}"`).
- **Auth:** `runner`.
- **Side-effects:** acquires `lock:node:{id}` (no double-dispatch); enqueues **`queue:node-run`** `{ node_id, run_id }`. The [Builder worker](../02-agent-system/parallel-orchestration.md) creates a git worktree, and **for each touched path acquires `lock:file:{project}:{path}`** (run-bound TTL) as the [parallel-safety backstop](../02-agent-system/dependency-inference-engine.md). On conflict the file-lock holder blocks/serializes with a visible reason. Node transitions `ready→running→built|failed` ([state machine](./realtime-and-state.md)); diff lands in `diff_artifact_path` (`diffs` bucket).

### `POST /nodes/:id/split`
Re-decompose a node to resolve a conflict (the [split-node strategy](../02-agent-system/dependency-inference-engine.md)).
- **Body:** `{ "run_id": uuid, "reason"?: str }`.
- **Response `202`:** `{ "run_id": uuid, "revision": int }`. Enqueues **`queue:replan`** scoped to the node; the planner hoists a shared-prerequisite node + independent children; engine re-derives edges. Acquires `lock:node:{id}`.

### `POST /nodes/:id/cancel`
Cancel a queued/running node build.
- **Response `200`:** updated `runs` row (`status:"cancelled"`). Releases `lock:node` and held `lock:file:*`; sends a cancel signal to the worker via the run's control key.

### `POST /plans/:id/edges` · `DELETE /edges/:id`  — *ratification: add/remove a dependency*
User adds a dependency the engine missed (becomes a **hard** edge) or removes one. Part of the [Stage-7 ratify handshake](../02-agent-system/dependency-inference-engine.md).
- **POST body:** `{ "from_node": uuid, "to_node": uuid, "type": "depends_on"|"data_flow"|"sequence"|"soft_order", "rationale"?: str }`.
- **Response:** `201` / `204`. **Side-effects:** acquires `lock:plan:{id}`; re-partitions branches (independence re-derived); emits `edge:*` + `branch:update` on `plan:{id}`. A user-added edge is marked `evidence.reason:"user_asserted"`.

### `GET /branches/:id`
Fetch a branch with its `node_ids`, `status`, and `independent_of[]`.

### `POST /branches/:id/ratify`
Confirm a branch as independent — **locks it for parallel dispatch** ([Stage-7](../02-agent-system/dependency-inference-engine.md)).
- **Body:** `{ "ratified": true }`. **Response `200`:** updated `branches` row. Persists ratification state; only ratified-or-high-confidence-independent branches are parallelized by execution.

### `POST /branches/:id/run`  — *Flow B (Run a branch in parallel)*
Dispatch every node in the branch, respecting intra-branch edges. Implements [Flow B](./high-level-architecture.md).
- **Body:** `{ "run_id": uuid, "model"?: str }`.
- **Response `202`:** `{ "branch_run_id": uuid, "node_runs": [{ node_id, run_id }] }`.
- **Auth:** `runner`.
- **Side-effects:** acquires `lock:branch:{id}`; creates the branch `worktree_path`; enqueues one **`queue:node-run`** per node in topological order of intra-branch `depends_on` edges. Each node build acquires `lock:file:{project}:{path}` per touched path — the cross-branch overlap guard. On all-nodes-built, an **Integration node** is enqueued automatically (see [§5](#5-integration)).

### `POST /plans/:id/run-selection`
Run an arbitrary multi-select of nodes (the canvas "run selection" affordance).
- **Body:** `{ "node_ids": uuid[], "run_id": uuid }`.
- **Response `202`:** `{ "node_runs": [...] }`. Enqueues `queue:node-run` per node respecting edges; same `lock:node` + `lock:file` discipline as branch run. Selection spanning multiple branches acquires each `lock:branch` it touches.

---

## 5. Integration

### `POST /plans/:id/integrate`  — *branch reconvergence*
Merge built branches back together with a test gate. Drives `integration_nodes` ([integration-merge.md](../02-agent-system/integration-merge.md)).
- **Body:** `{ "target_branches": uuid[], "run_id": uuid }`.
- **Response `202`:** the `integration_nodes` row (`status:"pending"`).
- **Auth:** `runner`.
- **Side-effects:** acquires `lock:branch` on each target; enqueues **`queue:integration`** `{ integration_node_id, run_id }`. The worker attempts the merge + runs the test gate. **No auto-merge on red:** conflicts populate `conflict_report` and surface to the user for adjudication; a clean merge sets `merge_commit` and transitions affected branches to `merged`, advancing `plans.status` toward `partially_merged`/`merged`.

### `GET /integration-nodes/:id`
Fetch an integration node incl. `conflict_report` and `merge_commit`.

---

## 6. Delegation & export

### `POST /plans/:id/delegate`  — *Flow D (Delegate a subtree)*
Serialize a subtree as a portable spec and grant access. Implements [Flow D](./high-level-architecture.md) + [subtree-delegation.md](../04-collaboration-delegation/subtree-delegation.md).
- **Body:**
  ```jsonc
  {
    "subtree_root_node": "uuid",
    "role": "viewer"|"runner"|"editor",
    "assigned_to_email": "dev@x.com",   // or assigned_to_user
    "assigned_to_user": "uuid"
  }
  ```
- **Response `201`:** the `delegations` row (`status:"draft"`→`"sent"`) with `spec_path`.
- **Side-effects:** the API serializes the portable spec (nodes/edges/touch-sets/analysis/`base_commit`) to the `specs` Storage bucket → `spec_path`; creates a `delegations` row **and** a corresponding `shares` grant (RLS) so the recipient can open it. Emits an `events` row.

### `GET /delegations/:id`
Fetch delegation state. **`POST /delegations/:id/accept`** — recipient opens the spec as a runnable mini-plan (`status:"accepted"→"building"`). **`POST /delegations/:id/return`** — recipient submits work back (`status:"returned"`); enqueues **`queue:integration`** for optional merge-back under `lock:plan:{id}`.

### `GET /plans/:id/export`
Export the whole plan (or `?subtree_root=`) as a portable spec without creating a delegation (download).
- **Response `200`:** the spec JSON (same shape persisted to `specs`), or `302` to a signed Storage URL for large specs.

---

## 7. Shares, comments, feedback

### `POST /shares`
Grant a principal access to a plan/project.
- **Body:** `{ "resource_type": "plan"|"project", "resource_id": uuid, "role": "viewer"|"runner"|"editor", "principal_user"?: uuid, "principal_email"?: str }`.
- **Response `201`:** `shares` row. **Auth:** `editor` on the resource. RLS grant takes effect immediately.

### `GET /shares?resource_id=` · `DELETE /shares/:id`
List / revoke grants on a resource.

### `POST /nodes/:id/comments` · `GET /nodes/:id/comments` · `PATCH /comments/:id`
Threaded discussion on a node (`comments`).
- **POST body:** `{ "body": str }`. **PATCH body:** `{ "body"?: str, "resolved"?: bool }`.
- **Side-effects:** emits `comment:*` on `plan:{id}`. A `viewer` may comment and edit/resolve their own; an `editor` may resolve any.

### `POST /nodes/:id/feedback`  — *trust loop (P2)*
Thumbs up/down on an analysis claim, feeding suppression of bad patterns ([analysis-annotation-agent.md](../02-agent-system/analysis-annotation-agent.md)).
- **Body:** `{ "annotation_path": "analysis[2]", "vote": "up"|"down", "reason"?: str }`.
- **Response `201`:** `feedback` row. **Auth:** `viewer`. Down-votes are aggregated to suppress recurring low-quality analysis patterns.

---

## 8. Runs (status & logs)

### `GET /runs/:id`
Fetch a run (`runs`) incl. `status`, `agent`, `model`, `tokens`, `cost`, `result`, `error`, `logs_stream_key`.

### `GET /runs/:id/logs`
Read archived/live logs.
- **Query:** `?from=<stream-id>&follow=true`. If the run is live, the API **relays the Redis Stream** `stream:run:{id}` over a WebSocket/SSE upgrade (the [WS relay](./realtime-and-state.md)); if finished, it streams the archived copy from the `logs` bucket. Emits token/diff-chunk events as they arrive.

### `GET /plans/:id/runs`
List runs for a plan (paginated), filterable by `?kind=`, `?status=`, `?node_id=`, `?branch_id=`.

---

## 9. Error model

All errors share one envelope:
```jsonc
{
  "error": {
    "code": "validation_failed",        // stable machine code (see table)
    "message": "human-readable summary",
    "details": [ { "path": "body.granularity", "issue": "invalid_enum_value" } ],
    "request_id": "req_01H...",          // echoes X-Request-Id for tracing
    "retryable": false
  }
}
```

| HTTP | `code` | When |
|------|--------|------|
| `400` | `bad_request` | malformed JSON / missing path param |
| `401` | `unauthenticated` | missing/expired JWT |
| `403` | `forbidden` | RLS/role denies the resource or action |
| `404` | `not_found` | resource absent **or** hidden by RLS (we do not leak existence) |
| `409` | `conflict` | lock held / illegal state transition (e.g. run on a `merged` node) |
| `409` | `lock_unavailable` | `lock:plan/branch/node` busy — caller may retry |
| `422` | `validation_failed` | zod schema violation; `details[]` lists field paths |
| `423` | `file_locked` | a `lock:file` overlap blocked dispatch (carries the conflicting path) |
| `429` | `rate_limited` | `ratelimit:org|user` exceeded; `Retry-After` header set |
| `500` | `internal` | unexpected; `request_id` for support |
| `503` | `dependency_unavailable` | analysis service / Redis / Claude transient outage; `retryable:true` |

`retryable:true` + `Retry-After` indicate safe client retry (the worker layer also retries Claude calls with backoff). State-transition conflicts (`409 conflict`) are **not** retryable without re-reading state.

---

## 10. Idempotency & concurrency

- **`run_id` as idempotency key.** Every run-creating endpoint (`/nodes/:id/run`, `/branches/:id/run`, `/run-selection`, `/replan`, `/integrate`, `/nodes/:id/split`) requires a client-generated `run_id`. The API upserts the `runs` row keyed on `run_id`; a replay with the same `run_id` returns the **existing** run (`200`) instead of creating a duplicate. This matches [data-model.md §8](./data-model.md): *"`runs.id` is the idempotency key for worker execution — a re-queued run is a no-op if already `succeeded`."*
- **Optimistic concurrency on mutations.** `PATCH` endpoints accept `If-Match: <plan.current_revision>` (or an `updated_at` ETag). A stale write returns `409 conflict` so the optimistic UI can reconcile (see [realtime-and-state.md](./realtime-and-state.md)).
- **Lock contention** surfaces as `409 lock_unavailable` (control locks) or `423 file_locked` (file-overlap backstop), never silent serialization at the API layer.

---

## 11. Pagination

- **Cursor-based**, stable under inserts. List endpoints accept `?limit=` (default 25, max 100) and `?cursor=`; respond with `{ "data": [...], "next_cursor": str|null }`. Cursors encode `(created_at, id)`. Realtime channels deliver subsequent inserts, so clients page history and subscribe forward.

## 12. Versioning

- **URI-versioned** (`/v1`). Breaking changes ship under `/v2`; `/v1` is supported through a deprecation window announced via the `Deprecation` and `Sunset` response headers. Additive fields are **not** breaking (clients ignore unknown fields). The shared JSON Schemas (zod ↔ pydantic, [tech-stack.md §7](./tech-stack.md)) version in lockstep with the route version.

---

## 13. Realtime channels

The API mutates Postgres; **Supabase Realtime** fans the durable changes out to subscribed clients (no polling). Redis carries ephemeral high-frequency signal relayed over WS. This is the durable-vs-ephemeral split detailed in [realtime-and-state.md](./realtime-and-state.md) and [ADR-2](./high-level-architecture.md).

| Channel | Backed by | Emits | Consumers |
|---------|-----------|-------|-----------|
| `plan:{id}` | Postgres change feed on `plan_nodes`, `plan_edges`, `branches`, `plans` | `node:insert/update`, `edge:insert/delete`, `branch:update`, `plan:status` — the live DAG re-flow | Graph canvas |
| `annotations:{plan_id}` | change feed on `node_annotations` | per-node `assumptions/analysis/benefits/notable_symbols/widget_specs` as they stream in (Flow A async tail) | Node inspector |
| `runs:{plan_id}` | change feed on `runs` + `integration_nodes` | `run:status` transitions (`queued→running→succeeded/failed`), `node_status`/`branch_status` changes, integration `conflict_report`/`merge_commit` | Canvas badges, run console |
| `stream:run:{id}` | **Redis Stream** via WS relay (not Postgres) | live log lines, Claude **token** deltas, **diff chunks** | Run console / streamed diff viewer |
| `presence:plan:{id}` | **Redis** pub/sub + TTL hash via WS relay | who is viewing/editing, cursors, selection | Collaboration avatars/cursors |
| `comments:{plan_id}` | change feed on `comments` | `comment:insert/update` (incl. `resolved`) | Inspector discussion |
| `events:{plan_id}` | change feed on `events` | audit/activity stream (delegations sent, shares granted, replans) | Activity feed |

Durable channels (`plan`, `annotations`, `runs`, `comments`, `events`) ride Supabase Realtime and are RLS-filtered — a subscriber only receives rows they could `GET`. Ephemeral channels (`stream:run`, `presence`) ride the Redis-backed WS relay because they are too high-frequency for the DB write path ([ADR-2](./high-level-architecture.md)).

---

## To-do list

- [ ] Scaffold the Fastify app with `/v1` prefix, zod request/response schemas, and JWT auth plugin that forwards the token to Postgres (RLS).
- [ ] Implement Projects + indexing endpoints; wire `POST /projects/:id/index` to analysis-service `POST /index`.
- [ ] Implement Plans CRUD + `POST /plans` (Flow A) enqueueing `queue:plan-build` under `lock:plan`.
- [ ] Implement `POST /plans/:id/replan` (Flow C) → `queue:replan`, writing `plan_revisions` and bumping `current_revision`.
- [ ] Implement Node endpoints incl. `run` (`queue:node-run`, `lock:node`+`lock:file`), `split`, `cancel`.
- [ ] Implement Edge add/remove + Branch `ratify`/`run` (Flow B) with topological dispatch and integration auto-enqueue.
- [ ] Implement `run-selection` with multi-branch lock acquisition.
- [ ] Implement Integration endpoints (`queue:integration`, no auto-merge on red, `conflict_report`).
- [ ] Implement Delegation + export (spec → `specs` bucket, paired `shares` grant) and accept/return.
- [ ] Implement Shares, Comments, Feedback endpoints.
- [ ] Implement Runs status + `GET /runs/:id/logs` WS/SSE relay of `stream:run:{id}`.
- [ ] Implement the error envelope + stable codes + `X-Request-Id` propagation into OTel traces.
- [ ] Implement `run_id` idempotency upsert and `If-Match` optimistic-concurrency checks.
- [ ] Implement cursor pagination helper and the seven Realtime channel subscriptions on the client.
- [ ] Generate and pin the OpenAPI doc from the zod schemas; version in lockstep with shared JSON Schemas.

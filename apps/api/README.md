# @trellis/api — Orchestration API + `/trellis` MCP launcher

Fastify orchestration REST API (all routes under `/v1`) plus a Model Context
Protocol launcher that exposes Trellis as MCP tools. The API **validates →
persists → enqueues → returns**; the long agent work runs in the workers and
streams back over Redis (SSE) and Supabase Realtime.

- Contracts come from `@trellis/shared` (zod DTOs, enums, entities, `QUEUES`, `keys`).
- Persistence is the service-role Supabase client from `@trellis/db`
  (`createAdminClient`). RLS is bypassed, so **every query is scoped by ids**
  (org / plan / project).
- Background work is enqueued with **BullMQ** to the queue names in `QUEUES`.

## Run

```bash
pnpm install                 # from the repo root (workspace)
cp ../../.env.example ../../.env   # fill in Supabase + Redis values

pnpm --filter @trellis/api dev        # REST API on :API_PORT (default 8080)
pnpm --filter @trellis/api mcp        # MCP launcher over stdio
pnpm --filter @trellis/api typecheck  # tsc --noEmit
pnpm --filter @trellis/api build      # tsc -> dist/
```

### Required env (see repo `.env.example`)

`API_PORT`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_JWT_SECRET`, `REDIS_URL`, `CORS_ALLOWED_ORIGINS`,
`TRELLIS_MCP_TOKEN_SECRET`, `MCP_SERVER_PORT`, `NEXT_PUBLIC_APP_URL`.

## Auth

`authPreHandler` reads `Authorization: Bearer <supabase-jwt>`, verifies it with
`SUPABASE_JWT_SECRET` (HS256 via `jose`), and attaches
`request.identity = { userId, orgId, email }` (`sub`, `org_id`, `email` claims).

**Dev bypass:** when `NODE_ENV=development` and no token is supplied, a fixed dev
identity is used (`DEV_IDENTITY` in `src/env.ts`).

### Dev seed

The dev identity references a fixed org + profile. Seed them once so foreign keys
resolve (Supabase Auth needs a matching `auth.users` row before `profiles`):

```sql
insert into organizations (id, name)
  values ('00000000-0000-0000-0000-000000000010', 'Dev Org')
  on conflict (id) do nothing;

-- profiles.id references auth.users(id); create the auth user first
-- (or relax the FK in local dev), then:
insert into profiles (id, org_id, display_name)
  values ('00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000010', 'Dev User')
  on conflict (id) do nothing;
```

A `specs` Storage bucket must exist for delegation spec uploads:

```sql
insert into storage.buckets (id, name) values ('specs', 'specs')
  on conflict (id) do nothing;
```

## REST surface (`/v1`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/v1/health` | Liveness (no auth) |
| `POST` | `/v1/projects` | Create a project |
| `GET`  | `/v1/projects` | List projects (org-scoped) |
| `POST` | `/v1/plans` | Flow A — insert plan (planning) + enqueue `queue:plan-build` → `{ plan_id }` |
| `GET`  | `/v1/plans/:id` | Assemble + return a `PlanGraph` |
| `POST` | `/v1/plans/:id/replan` | Flow C — enqueue `queue:replan` → `{ revision }` |
| `POST` | `/v1/plans/:id/run` | Run nodes/branches — enqueue `queue:node-run` per node |
| `POST` | `/v1/branches/:id/run` | Run every node in a branch |
| `POST` | `/v1/plans/:id/delegate` | Flow D — write subtree spec to `specs` bucket + `delegations` + paired `shares` |
| `POST` | `/v1/shares` | Grant access to a plan/project |
| `POST` | `/v1/nodes/:id/feedback` | Thumbs up/down on an analysis claim |
| `GET`  | `/v1/runs/:id/stream` | **SSE** tail of Redis stream `stream:run:{id}` (`XREAD BLOCK`) |

## MCP tools (`src/mcp/server.ts`)

| Tool | Maps to |
|------|---------|
| `trellis_plan({ prompt, project_id? })` | `createPlan` → `{ plan_id, canvas_url }` (`${NEXT_PUBLIC_APP_URL}/p/{plan_id}`) |
| `trellis_get_plan({ plan_id })` | compact text summary of the plan graph |
| `trellis_status({ plan_id })` | live per-status node counts + running nodes |
| `trellis_run_branch({ branch_id })` | dispatch every node in a branch |

Calls are bound to a Trellis token (`TRELLIS_MCP_TOKEN_SECRET`); in dev they fall
back to the same dev identity as the REST bypass. The MCP server reuses the
`src/services/*` modules, so REST and MCP share identical logic.

## Structure

```
src/
  index.ts          server bootstrap (Fastify, /v1, CORS, error envelope)
  env.ts            env access + DEV_IDENTITY
  auth.ts           JWT preHandler (jose HS256) + dev bypass
  errors.ts         stable error envelope (api-design.md §9)
  queue.ts          BullMQ queue factory + ioredis connections
  supabase.ts       service-role client singleton
  routes/           health, projects, plans, branches, nodes, shares, runs (SSE)
  services/         projects, plans, runs, delegations, shares, feedback, summary
  mcp/server.ts     MCP launcher
```

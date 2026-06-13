# Repo Structure

> Status: **Canonical.** Defines the concrete pnpm-workspace monorepo layout, each package's responsibility/interface/dependencies, where the cross-language contracts live, and how to run the whole stack locally.

This is the physical realization of the architecture in [`../01-architecture/high-level-architecture.md`](../01-architecture/high-level-architecture.md) and the stack in [`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md) §7. Entity/field names referenced here are authoritative in [`../01-architecture/data-model.md`](../01-architecture/data-model.md). Code-ownership boundaries align to the agent/UI/architecture docs.

---

## 1. Top-level layout

```
trellis/
├─ apps/
│  ├─ web/                  # Next.js (App Router) — the generative-UI surface
│  └─ api/                  # Fastify orchestration API (REST, authz, enqueue)
├─ workers/                 # BullMQ agent workers (planner/dep/analysis/builder/replan)
├─ packages/
│  ├─ shared/              # TS types, zod schemas, generated-from-JSON-Schema contracts
│  ├─ ui/                  # Component library + the validated widget/layout REGISTRY
│  ├─ db/                  # Supabase migrations, generated DB types, RLS policies, seed
│  ├─ agent-core/          # Anthropic SDK wrapper, tool-use loop, prompt-cache, model routing
│  ├─ git-worktree/        # Worktree lifecycle, locks client, sandbox exec wrapper
│  └─ config/              # Shared tsconfig, eslint, prettier, vitest presets
├─ services/
│  └─ analysis/            # Python FastAPI: tree-sitter + networkx (the dependency core)
├─ contracts/              # SOURCE OF TRUTH: cross-language JSON Schemas + codegen
│  ├─ schemas/             # *.schema.json (TouchSet, Edge, Overlap, WidgetSpec, …)
│  └─ codegen/             # JSON Schema → zod (TS) and → pydantic (Py) generators
├─ eval/                   # D15 golden-repo eval harness (fixtures, runner, metrics)
│  ├─ golden-repos/        # hand-labeled repos + change-sets + expected dep graphs
│  ├─ adversarial/         # hidden-config, transitive-type, same-file-disjoint, …
│  └─ runner/              # metric computation (FIR, precision/recall, speedup)
├─ infra/                  # docker-compose (Redis), Supabase config, deploy manifests
├─ tests/e2e/              # Playwright specs over the canvas
├─ .github/workflows/      # CI: typecheck, lint, unit, contract, eval gates
├─ pnpm-workspace.yaml
├─ turbo.json              # task pipeline (build/lint/typecheck/test) + caching
├─ package.json            # root scripts
├─ tsconfig.base.json
├─ .env.example
└─ CODEOWNERS
```

> The Python service lives under `services/` (not `packages/`) because it is a separate runtime with its own dependency manager (`uv`/`pip`) and is **not** part of the pnpm graph. The pnpm workspace covers `apps/*`, `workers`, and `packages/*`.

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "workers"
  - "packages/*"
```

---

## 2. Cross-language contracts (`contracts/`) — the load-bearing boundary

The hybrid TS+Python design ([`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md) §0) only works if both sides agree byte-for-byte on the wire shapes. **JSON Schema is the single source of truth**; zod and pydantic are *generated*, never hand-edited.

```
contracts/
├─ schemas/
│  ├─ touch-set.schema.json        # plan_nodes.touch_set (data-model §5)
│  ├─ edge-evidence.schema.json    # plan_edges.evidence (data-model §5)
│  ├─ overlap.schema.json          # /overlap response (dep-engine §7)
│  ├─ resolve-touchset.schema.json # /resolve-touchset request+response
│  ├─ callgraph-impact.schema.json # /callgraph-impact response
│  ├─ symbol-graph.schema.json     # symbol/import/call/type graph
│  ├─ node.schema.json             # Planner Node output (D3)
│  ├─ annotation.schema.json       # node_annotations (D5) sections
│  └─ widget-spec.schema.json      # validated widget specs (registry-checked)
└─ codegen/
   ├─ to-zod.ts                    # json-schema-to-zod → packages/shared/src/generated/
   └─ to-pydantic.py              # datamodel-code-generator → services/analysis/contracts/
```

- **Codegen targets.** `pnpm contracts:gen` writes `packages/shared/src/generated/*.ts` (zod) and `services/analysis/trellis_analysis/contracts/*.py` (pydantic). Both generated dirs are committed and **CI-verified clean** (regenerate → `git diff --exit-code`).
- **Contract tests** (D15-adjacent): for each schema, a fixture is validated by zod and pydantic; a round-trip test asserts the same JSON parses identically on both sides. See [`testing-and-eval.md` §contract](./testing-and-eval.md).
- **Versioning.** Schemas carry a `$id` with a version; the portable-spec contract (D14) is the externally-published subset (platform, M9 in [`milestones-and-phases.md`](./milestones-and-phases.md)).

---

## 3. Packages — responsibility · key modules · deps · public interface

### `apps/web` — Next.js generative-UI surface (P4)
- **Responsibility.** Render the graph canvas + node inspector + generated widgets; capture intent/context; optimistic UI; subscribe to realtime. **No business logic, never calls Claude directly** ([`../01-architecture/high-level-architecture.md`](../01-architecture/high-level-architecture.md) §2).
- **Key modules.**
  - `src/app/` — App Router routes (plan view, project list, delegation inbox).
  - `src/canvas/` — React Flow DAG; layout engines (`dagre`/`elk.js`; custom swimlane for G3; hierarchical clustering for G4) — implements D9, D11.
  - `src/inspector/` — five-section node inspector (D10), renders D5 analysis with code citations.
  - `src/widgets/` — change-type widget renderers (schema-diff, api-contract, component-preview, call-graph-impact) — render from validated specs only (ADR-5).
  - `src/state/` — Zustand (selection/layout/optimistic) + TanStack Query (server state).
  - `src/realtime/` — Supabase Realtime + Redis-stream relay subscriptions (D12).
- **Depends on.** `packages/shared` (types/zod), `packages/ui` (components + registry), Supabase JS client, `apps/api` (REST).
- **Public interface.** The rendered app + a thin server-action layer; consumes `api` REST + Supabase Realtime.

### `apps/api` — Fastify orchestration API
- **Responsibility.** AuthZ, validation (zod), persistence, **enqueue jobs**. Exposes REST. Does **not** run long agent loops inline (that's `workers`).
- **Key modules.**
  - `src/routes/` — `/plans`, `/nodes/:id/run`, `/branches/:id/run`, `/plans/:id/replan`, `/plans/:id/delegate`, `/plans/:id/share`, ratify endpoints (confirm/add/split edges).
  - `src/authz/` — Supabase JWT verification, role checks (viewer/runner/editor), RLS-scoped service-role queries.
  - `src/enqueue/` — BullMQ producers for `plan-build`, `node-run`, `analysis`, `integration`, `replan`.
  - `src/validation/` — zod request/response schemas (from `packages/shared`).
- **Depends on.** `packages/shared`, `packages/db` (typed client), Redis (BullMQ), Supabase.
- **Public interface.** The REST surface in [`../01-architecture/high-level-architecture.md`](../01-architecture/high-level-architecture.md) §3 / `api-design.md`.

### `workers` — BullMQ agent workers
- **Responsibility.** The agent loops: Planner / Dependency-Inference / Analysis-Annotation / Builder / Replan-Drift. Call Claude + the analysis service; manage worktrees. **Owns no durable schema, renders no UI.**
- **Key modules.**
  - `src/planner/` — D3 (Opus): decompose → Nodes + predicted touch-sets, granularity detection, schema-forced output.
  - `src/dependency/` — **D4, the crux**: edge derivation (Stage 4), independence/overlap classifier (Stage 5), false-independence detector, DAG builder + branch partition + integration-node insertion, confidence propagation, conflict-resolution strategies, drift re-derivation hook. Calls `services/analysis`.
  - `src/analysis/` — D5 (Opus): assumptions/risks/benefits/notable-symbols, grounded refs, widget-spec generation (Sonnet).
  - `src/builder/` — D6 (Sonnet): worktree build loop via `packages/git-worktree`; streams logs/diff to `stream:run:{id}`.
  - `src/integration/` — D7: merge attempt + test gate + conflict report.
  - `src/replan/` — D8: revised revisions + incremental dependency re-derivation.
- **Depends on.** `packages/shared`, `packages/agent-core` (Claude loop), `packages/git-worktree`, `packages/db`, the analysis service (HTTP), Redis.
- **Public interface.** Queue consumers keyed by `runs.id` (idempotent); no external HTTP.

### `packages/shared` — types, zod schemas, generated contracts
- **Responsibility.** The TypeScript contract layer shared across `web`/`api`/`workers`. Holds enums ([`../01-architecture/data-model.md`](../01-architecture/data-model.md) §1), domain types, zod schemas, and the **generated-from-JSON-Schema** zod (`src/generated/`).
- **Key modules.** `src/enums.ts`, `src/types/`, `src/zod/`, `src/generated/` (committed, CI-verified), `src/redis-keys.ts` (the key schema from data-model §6).
- **Depends on.** `contracts/` (via codegen). No runtime deps on apps.
- **Public interface.** Exported types + zod validators imported everywhere TS runs.

### `packages/ui` — component library + the widget/layout REGISTRY
- **Responsibility.** shadcn/ui (Radix) + Tailwind primitives **and** the **component registry** that validates generated widget/layout specs (ADR-5). The model emits specs; this registry is the allow-list — no raw model HTML ever renders.
- **Key modules.** `src/primitives/`, `src/registry/` (the canonical map `widget name → component + props schema`), `src/widgets/` (schema-diff, api-contract, component-preview, call-graph-impact), `src/layouts/` (G1 diff-first, G2 compact, G3 swimlane, G4 zoomable).
- **Depends on.** `packages/shared` (widget-spec types), Tailwind, Radix, Monaco/Shiki.
- **Public interface.** Components + `validateWidgetSpec(spec)` / `resolveLayout(granularity, change_type, context)`. This is the package **published** for platform/embeddability (M9).

### `packages/db` — Supabase migrations, types, RLS, seed
- **Responsibility.** The durable-data contract. SQL migrations for all tables in [`../01-architecture/data-model.md`](../01-architecture/data-model.md), RLS policies (`security-and-auth.md`), generated DB types, and seed/golden fixtures.
- **Key modules.** `migrations/`, `policies/` (RLS), `src/generated-types.ts` (`supabase gen types`), `seed/`, `src/client.ts` (typed service-role + anon clients).
- **Depends on.** Supabase CLI. Imported by `api`/`workers` for typed DB access.
- **Public interface.** Typed Supabase clients + migration set.

### `packages/agent-core` — Claude SDK wrapper
- **Responsibility.** Anthropic TypeScript SDK wrapper: tool-use loop, **prompt caching** of the repo-context block, model routing (Opus 4.8 for plan/dep/analysis, Sonnet 4.6 for build/widgets — [`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md) §6), schema-validated tool outputs with bounded repair retries, token/cost accounting.
- **Key modules.** `src/loop.ts`, `src/tools/` (analysis-service calls, file read/write, test runner, git), `src/models.ts` (model-pluggable interface), `src/cache.ts`.
- **Depends on.** `packages/shared`, `@anthropic-ai/sdk`.
- **Public interface.** `runAgent({ system, tools, model, cacheBlock })` → schema-valid result + usage.

### `packages/git-worktree` — worktree + locks + sandbox
- **Responsibility.** Ephemeral git worktree lifecycle (one per branch, ADR-3), the `lock:file`/`lock:branch`/`lock:node` Redlock client, and the sandboxed-exec wrapper (resource/network-limited).
- **Key modules.** `src/worktree.ts`, `src/locks.ts` (Redlock), `src/sandbox.ts`, `src/diff.ts`.
- **Depends on.** `isomorphic-git`/native git, Redis, `packages/shared` (key schema).
- **Public interface.** `withWorktree(branch, fn)`, `acquireFileLock(project, path)`.

### `packages/config` — shared dev config
- Shared `tsconfig`, ESLint, Prettier, Vitest presets; consumed by every TS package via `extends`.

### `services/analysis` — Python FastAPI dependency core
- **Responsibility.** Parse repos (tree-sitter), build symbol/import/call/type graphs (networkx), resolve predicted touch-sets to real symbols, compute blast radius + overlap. **Stateless, cache-backed by Redis, no DB of its own** ([`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md) §3).
- **Key modules.**
  - `trellis_analysis/api.py` — FastAPI endpoints: `index_repo`, `symbol-graph`, `resolve-touchset`, `overlap`, `callgraph-impact` ([`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md) §7).
  - `trellis_analysis/parse/` — tree-sitter (TS/JS first, Python second).
  - `trellis_analysis/graphs/` — networkx import/call/type graphs; reachability/overlap/cycle algorithms.
  - `trellis_analysis/resolve/` — predicted→real symbol matching + new-symbol detection + confidence.
  - `trellis_analysis/surfaces/` — framework/config-surface detectors (routers, DI, env/config, migration dirs).
  - `trellis_analysis/contracts/` — **generated pydantic** (from `contracts/`), never hand-edited.
  - `trellis_analysis/cache.py` — Redis cache (`cache:symbolgraph:{project}:{commit}`).
- **Depends on.** `contracts/` (pydantic codegen), Redis, Supabase Storage (artifacts).
- **Public interface.** The HTTP API above; deterministic given `{commit, touch-set}`.
- **Dep manager.** `uv` / `pyproject.toml` (independent of pnpm).

---

## 4. Config, env, scripts

### Root scripts (`package.json`, run via Turbo)
```jsonc
{
  "dev":         "turbo run dev",                 // all TS apps + workers
  "dev:py":      "uv run --directory services/analysis fastapi dev",
  "build":       "turbo run build",
  "typecheck":   "turbo run typecheck",
  "lint":        "turbo run lint",
  "test":        "turbo run test",                 // unit (TS via vitest)
  "test:py":     "uv run --directory services/analysis pytest",
  "test:e2e":    "playwright test",                // tests/e2e
  "contracts:gen":   "tsx contracts/codegen/to-zod.ts && uv run python contracts/codegen/to-pydantic.py",
  "contracts:check": "pnpm contracts:gen && git diff --exit-code",
  "eval":        "tsx eval/runner/index.ts",       // D15 harness (FIR/precision/recall/speedup)
  "db:migrate":  "supabase db push",
  "db:types":    "supabase gen types typescript --local > packages/db/src/generated-types.ts"
}
```

### Environment (`.env.example`)
| Var | Used by | Purpose |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | workers, agent-core | Claude |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | web, api, workers | data plane |
| `REDIS_URL` | api, workers, analysis | queues/locks/cache/streams |
| `ANALYSIS_SERVICE_URL` | workers | Python service base URL |
| `GITHUB_OAUTH_CLIENT_ID/SECRET` | api | repo onboarding (D1) |
| `STORAGE_BUCKET_*` | workers, analysis | `repo-index`/`diffs`/`logs`/`specs` |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `POSTHOG_KEY` | all | observability (D16) |

### Lint / typecheck / test setup
- **TS:** ESLint + Prettier + `tsc --noEmit` per package via `packages/config`; **Vitest** for unit; **Playwright** for e2e over the canvas.
- **Python:** **ruff** (lint+format) + **mypy** (types) + **pytest** for the analysis service.
- **Cross-language:** contract tests (§2) run in both `pnpm test` and `pytest`; the `contracts:check` gate blocks drift.

---

## 5. Running locally

```bash
# 0. prerequisites: node 20+, pnpm, uv (python), docker, supabase CLI
cp .env.example .env            # fill ANTHROPIC_API_KEY + GitHub OAuth

# 1. infra: local Supabase (Postgres+Auth+Realtime+Storage) and Redis
supabase start                  # local Supabase stack
docker compose -f infra/docker-compose.yml up -d redis

# 2. database: migrations + RLS + generated types + seed/golden fixtures
pnpm db:migrate && pnpm db:types

# 3. contracts: generate zod + pydantic from JSON Schema
pnpm install && pnpm contracts:gen

# 4. python analysis service (separate runtime)
uv sync --directory services/analysis
pnpm dev:py                     # FastAPI on ANALYSIS_SERVICE_URL

# 5. TS apps + workers
pnpm dev                        # web (Next.js) + api (Fastify) + workers (BullMQ)
```

This mirrors the data/control-plane split (ADR-2): **Supabase = durable truth + realtime**, **Redis = queues/locks/streams/presence**, **Python service = stateless dependency core**.

---

## 6. Code-ownership boundaries (`CODEOWNERS`)

| Path | Owning track (see [`milestones-and-phases.md` §3](./milestones-and-phases.md)) | Aligned doc area |
|------|------------------------------------------------------------------------------|------------------|
| `services/analysis/`, `workers/src/dependency/`, `contracts/` | **Dependency engine / analysis** | `02-agent-system/dependency-inference-engine.md` |
| `workers/src/{planner,analysis,builder,replan,integration}/`, `packages/agent-core` | **Agents** | `02-agent-system/*` |
| `apps/api`, `workers/src/builder` locks, `packages/{db,git-worktree}` | **Orchestration / backend** | `01-architecture/*` |
| `apps/web`, `packages/ui` | **Generative UI / frontend** | `03-generative-ui/*` |
| `eval/`, `infra/`, `.github/workflows/`, observability | **Quality / platform** | `05-implementation/testing-and-eval.md`, `01-architecture/deployment-and-infra.md` |

The `contracts/` boundary is co-owned by dependency-engine + agents + frontend because it is the shared wire between TS and Python — changes there require review from both sides.

---

## To-do list

### Workspace & tooling
- [ ] Scaffold pnpm workspace (`apps/web`, `apps/api`, `workers`, `packages/*`) + `turbo.json` + `tsconfig.base.json`.
- [ ] `packages/config` shared tsconfig/eslint/prettier/vitest presets.
- [ ] `services/analysis` Python project (`uv`/`pyproject.toml`, ruff, mypy, pytest).
- [ ] Root scripts (`dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `eval`, `db:*`).

### Contracts (cross-language boundary)
- [ ] `contracts/schemas/*.schema.json` for TouchSet, Edge evidence, Overlap, resolve-touchset, callgraph-impact, symbol-graph, Node, Annotation, WidgetSpec.
- [ ] `contracts/codegen/to-zod.ts` and `to-pydantic.py`; commit generated output.
- [ ] `contracts:check` CI gate (regen → `git diff --exit-code`).
- [ ] Contract round-trip tests (zod ↔ pydantic) — ties to [`testing-and-eval.md`](./testing-and-eval.md).

### Packages
- [ ] `packages/shared` — enums, domain types, zod, `redis-keys.ts`, `generated/`.
- [ ] `packages/db` — migrations, RLS policies, generated DB types, seed/golden fixtures.
- [ ] `packages/ui` — primitives + **registry** (`validateWidgetSpec`, `resolveLayout`) + widgets + G1–G4 layouts.
- [ ] `packages/agent-core` — Claude tool-loop, prompt cache, model routing, usage accounting.
- [ ] `packages/git-worktree` — worktree lifecycle + Redlock locks + sandbox exec.

### Apps / workers / service
- [ ] `apps/api` — routes, authz, zod validation, BullMQ producers.
- [ ] `workers` — planner/dependency/analysis/builder/integration/replan consumers (idempotent on `runs.id`).
- [ ] `apps/web` — canvas, inspector, widgets, state, realtime.
- [ ] `services/analysis` — parse/graphs/resolve/surfaces/cache + FastAPI endpoints.

### Infra & ownership
- [ ] `infra/docker-compose.yml` (Redis) + Supabase local config + deploy manifests (D16).
- [ ] `CODEOWNERS` per §6; `.github/workflows` CI (typecheck/lint/unit/contract/eval gates).
- [ ] Local-run docs verified end-to-end (`supabase start` → `pnpm dev` round-trips a plan).

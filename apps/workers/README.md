# @trellis/workers — the BullMQ agent workers (the BRAIN)

One Node process that runs **four BullMQ workers** consuming the queues in
`@trellis/shared` `QUEUES`. It is the orchestration brain of Trellis: it turns a
plan request into a grounded dependency graph, annotates it, executes approved
nodes via a pluggable coding **runner**, and reconverges branches.

Models (Anthropic SDK): `PLANNER_MODEL` / `ANALYSIS_MODEL` = Opus
(`claude-opus-4-8`), `WIDGET_MODEL` = Sonnet (`claude-sonnet-4-6`).
Persistence: Supabase via `@trellis/db`. Live run feeds: Redis streams
(`stream:run:{run_id}`).

> **Design stance — degrade, never crash.** A missing repo, an unreachable
> analysis service, or an absent Claude Code binary all degrade to a sane
> fallback (sample repo / TS-side heuristics / native stub). A bad job is logged
> and the durable failure is recorded; the process keeps consuming.

## The four workers

| Queue | Worker | Job | What it does |
|-------|--------|-----|--------------|
| `queue:plan-build` | `src/workers/plan-build.ts` | `{plan_id}` | Load plan+project → ensure repo (clone w/ `GITHUB_TOKEN` or sample) → `POST /index` (best-effort) → **Planner (Opus)** emits Nodes + plan `LayoutSpec` with granularity detection → **Dependency engine** resolves touch-sets, derives edges + branch partition → persist nodes/edges/branches, `plan.status='ready'`, write `events` → enqueue one `analysis` job per node. |
| `queue:analysis` | `src/workers/analysis.ts` | `{node_id}` | **Analysis/Annotation agent (Opus)** produces the five inspector sections (assumptions / analysis / benefits / notable_symbols, each with `grounded_refs`) + per-node `WidgetSpec[]` keyed by `change_type`. Ground-or-flag enforced; persisted to `node_annotations`. Best-effort + re-runnable. |
| `queue:node-run` | `src/workers/node-run.ts` (concurrency = `MAX_CONCURRENT_BRANCHES`) | `{node_id}` | Create an ephemeral git worktree off `base_commit`, build a `WorkOrder` from the node + its annotation, run the **runner** selected by `EXECUTION_BACKEND`, relay `RunnerEvent`s to `stream:run:{run_id}`, harvest `git diff`, audit **drift** (files outside the touch-set) → `events`, update `runs` + `plan_nodes.status`. Idempotent on already-built nodes. |
| `queue:integration` | `src/workers/integration.ts` | `{plan_id}` | Merge the plan's built branches onto a fresh integration worktree (sequential `git merge --no-ff`), run the project's test command if present, set statuses. **No auto-merge on red** — on conflict/red-gate it writes a `conflict_report` and stops (`partially_merged`). |

## The runner

`AgentRunner` is the pluggable execution interface (`@trellis/shared`). The
registry (`src/runners/index.ts`) resolves by `EXECUTION_BACKEND`:

- **`ClaudeCodeRunner`** (`src/runners/claude-code.ts`, v1 default): spawns
  `CLAUDE_CODE_PATH -p "<prompt>" --output-format stream-json --permission-mode <mode> --max-turns N`
  with `cwd=worktree` and an injected **`CLAUDE.md`** carrying the touch-set
  guardrails / assumptions / risks. It parses `stream-json` → `RunnerEvent`s.
  Orchestration (not the runner) owns the diff harvest, drift audit, and test gate.
- **`NativeRunner`** (`src/runners/native.ts`): a tiny stub behind the same
  interface — writes a placeholder, notes it's a stub. The fallback when Claude
  Code is unavailable (the binary missing also auto-falls-back to it).

## Other modules

- `src/index.ts` — boots all four workers + graceful shutdown.
- `src/queue.ts` — ioredis/BullMQ connection + Queue factory.
- `src/anthropic.ts` — Anthropic client + `toolForcedJSON()` (tool-forced JSON,
  zod validation, ≤2 bounded repairs).
- `src/agents/planner.ts` — Planner agent + granularity detection (G1–G4).
- `src/agents/analysis.ts` — Analysis/Annotation agent + widget mapping.
- `src/engine/dependency.ts` — touch-set resolution, edge derivation, branch
  partition (calls the analysis service; TS fallback when absent).
- `src/analysis.ts` — typed best-effort client for the Python analysis service.
- `src/worktree.ts` — repo cache + ephemeral worktree helpers (`simple-git`).
- `src/repo-summary.ts` — compact repo-context block for the planner.
- `src/stream.ts` — Redis-stream writer for `stream:run:{run_id}`.
- `src/supabase.ts` — service-role client + `events` helper.
- `src/env.ts` / `src/log.ts` — config + leveled logger.

## Scripts

```bash
pnpm --filter @trellis/workers dev        # tsx watch src/index.ts
pnpm --filter @trellis/workers typecheck  # tsc --noEmit
pnpm --filter @trellis/workers build      # tsc
```

## Required env (see root `.env.example`)

`REDIS_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ANTHROPIC_API_KEY`, `PLANNER_MODEL`, `ANALYSIS_MODEL`, `WIDGET_MODEL`,
`ANALYSIS_SERVICE_URL`, `EXECUTION_BACKEND`, `CLAUDE_CODE_PATH`,
`CLAUDE_CODE_MODEL`, `CLAUDE_CODE_PERMISSION_MODE`, `CLAUDE_CODE_MAX_TURNS`,
`WORKTREE_ROOT`, `MAX_CONCURRENT_BRANCHES`, `GITHUB_TOKEN`.

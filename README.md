# Trellis

> Generative-UI agentic coding planner. You describe code work; Trellis produces an **interactive dependency graph** of the changes (grounded analysis per node), lets you **dispatch independent branches in parallel** to a coding agent (Claude Code), and **prune/delegate a subtree** to another user.

The full product/architecture plan lives in [`plan/`](./plan/README.md). This README is the build's quickstart.

## Monorepo layout

| Path | What |
|------|------|
| `apps/web` | Next.js app — the generative-UI canvas (React Flow), node inspector, change-type widgets |
| `apps/api` | Fastify orchestration REST API (`/v1`) + the `/trellis` MCP launcher server |
| `apps/workers` | BullMQ workers — planner, dependency engine, analysis/annotation agents, the Claude Code build runner, integration |
| `services/analysis` | Python FastAPI dependency-analysis service (tree-sitter + networkx) |
| `packages/shared` | `@trellis/shared` — zod schemas + TS types shared across all TS apps (the contracts) |
| `packages/db` | `@trellis/db` — Supabase Postgres schema/migrations + typed admin client |

## Prerequisites
- Node ≥ 20, pnpm ≥ 9
- Docker (for Redis)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`supabase`)
- Python ≥ 3.11 + [uv](https://docs.astral.sh/uv/) (for the analysis service)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) on PATH (the build runner)

## Quickstart
```bash
cp .env.example .env          # fill in keys (see comments in that file)
pnpm install                  # install all TS workspaces
docker compose up -d          # Redis
supabase start                # local Postgres/Auth/Realtime/Storage
pnpm db:migrate               # apply packages/db/migrations
# analysis service:
cd services/analysis && uv sync && uv run uvicorn app.main:app --reload --port 8000
# everything else (web + api + workers):
pnpm dev
```

App: http://localhost:3000 · API: http://localhost:8080 · Analysis: http://localhost:8000

See each package's own `README.md` for details. Scope is the **MVP** described in `.env.example` and `plan/00-overview/scope.md`.

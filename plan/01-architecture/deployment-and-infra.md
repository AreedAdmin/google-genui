# Deployment & Infrastructure

> Status: **Canonical.** Defines the deployment topology, environments, CI/CD pipeline, per-service scaling and failure/restart semantics, observability, cost controls, and backups/DR for Trellis.

This doc operationalizes the [high-level architecture](./high-level-architecture.md) and [tech-stack §7](./tech-stack.md) for running systems. It deploys the services, queues, locks, and Realtime channels defined in [data-model.md](./data-model.md), [realtime-and-state.md](./realtime-and-state.md), and [api-design.md](./api-design.md), and honors the trust-bar phasing in [security-and-auth.md](./security-and-auth.md).

---

## 1. Deployment topology

```
                          ┌───────────────────────────────────────────────┐
                          │  Users (browser)                              │
                          └───────────────┬───────────────────────────────┘
                                          │ HTTPS / WSS
                                          ▼
                          ┌───────────────────────────────────────────────┐
                          │  WEB  (Next.js)         Vercel or container    │
                          │  SSR shell + React Flow canvas; Supabase JS    │
                          └───────┬───────────────────────────┬───────────┘
                  REST /v1 (HTTPS)│                            │ Realtime sub (WSS)
                                  ▼                            ▼
          ┌───────────────────────────────────┐   ┌──────────────────────────────────┐
          │  API  (Fastify, container)        │   │  SUPABASE (managed)              │
          │  authz · zod · enqueue · WS relay │   │  Postgres + RLS                  │
          │  N stateless replicas behind LB   │◄──┤  Auth · Realtime · Storage       │
          └───┬───────────────┬───────────────┘   │  buckets: repo-index/diffs/      │
              │ enqueue        │ read/write        │           logs/specs            │
              ▼                ▼                   └──────────────────────────────────┘
   ┌────────────────────┐  ┌──────────────────────────────────────────────┐
   │  REDIS (managed)   │  │  WORKERS (containers, autoscaled per queue)   │
   │  queues · locks    │◄─┤  ┌─────────┐┌─────────┐┌─────────┐┌─────────┐ │
   │  streams · cache   │  │  │plan-    ││analysis ││node-run ││integration│
   │  presence · rl     │  │  │build    ││         ││+ replan ││           │
   └────────┬───────────┘  │  └─────────┘└─────────┘└────┬────┘└─────────┘ │
            │              └───────────────────┬─────────┼──────────────────┘
            │ cache rw                          │ HTTP    │ spawns sandbox
            ▼                                   ▼         ▼
   ┌────────────────────────────────┐  ┌────────────────────────────────────┐
   │  ANALYSIS SVC (Python/FastAPI) │  │  EPHEMERAL SANDBOX (per node-run)   │
   │  tree-sitter · networkx        │  │  microVM/gVisor · worktree · no     │
   │  stateless, behind Redis cache │  │  egress · resource caps (sec doc)   │
   │  autoscaled replicas           │  └────────────────────────────────────┘
   └────────────────────────────────┘
                    │ allow-listed egress proxies
                    ▼
            ┌───────────────┐
            │  CLAUDE API   │  Opus 4.8 (plan/dep/analysis) · Sonnet 4.6 (build/widgets)
            └───────────────┘
```

**Managed where possible** (Supabase, Redis, Vercel, Claude) to keep operational surface small for v1; **containerized** for the stateful/CPU-heavy services we must control (API, workers, analysis, sandboxes).

| Service | Runtime | Stateful? | Scaling unit |
|---------|---------|-----------|--------------|
| Web | Vercel (or container) | no | edge/CDN + SSR replicas |
| API (Fastify) | container behind LB | no | request-rate replicas |
| Workers | containers | no (state in PG/Redis) | **per-queue** replica pools |
| Analysis svc (Python) | container | no (cache in Redis) | request/CPU replicas |
| Sandboxes | ephemeral microVM/gVisor | no (destroyed per run) | per-run, capped per org |
| Postgres / Auth / Realtime / Storage | Supabase managed | yes | managed tier |
| Redis | managed | yes (ephemeral semantics) | managed tier + HA |

---

## 2. Environments

| Env | Purpose | Supabase | Redis | Workers | Sandbox tier |
|-----|---------|----------|-------|---------|--------------|
| **dev** | local; docker-compose Supabase + Redis | local stack | local | 1 of each | gVisor (or local container) |
| **preview** | per-PR ephemeral deploy (Vercel preview + branch DB) | branch DB | shared dev cluster | scaled-to-zero | gVisor |
| **staging** | prod-like; eval-gate + smoke | dedicated project | dedicated | small pool | matches prod |
| **prod** | live | dedicated project | HA cluster | autoscaled pools | Firecracker/hardened gVisor ([sec doc §4.6](./security-and-auth.md)) |

- **Config** is fully env-var driven; secrets come from the secrets broker ([security-and-auth.md §7](./security-and-auth.md)), never baked into images.
- **DB migrations** are versioned (Supabase migrations) and applied automatically on staging/prod deploy; preview uses a branched DB seeded with fixtures.
- Phase A (internal) and Phase B (customer-facing) trust bars map onto staging/prod sandbox tiers ([security-and-auth.md §4.6](./security-and-auth.md)).

---

## 3. CI/CD pipeline

Monorepo (pnpm workspaces: `apps/web`, `apps/api`, `apps/workers`, `packages/shared`, `services/analysis`; [tech-stack.md §7](./tech-stack.md)). One pipeline, path-filtered per package.

```
push / PR
  │
  ├─ install (pnpm + uv/pip for Python)
  ├─ typecheck   (tsc across TS packages)  +  mypy (analysis svc)
  ├─ lint        (eslint/prettier)         +  ruff (Python)
  ├─ contracts   (shared JSON Schema ↔ zod ↔ pydantic parity check)
  ├─ unit tests  (vitest TS · pytest Python)
  ├─ EVAL GATE   (dependency-engine golden-repo suite: FIR / precision-recall /
  │               parallel-correctness — see testing-and-eval.md)   ◀── blocks merge
  ├─ build images (api, workers, analysis) + web build
  └─ preview deploy (Vercel preview + branch DB)  ──▶  smoke test
                                                   │
                            merge to main ─────────┤
                                                   ▼
                              deploy staging ─▶ migrations ─▶ smoke + eval-gate
                                                   │
                                  manual gate ─────┤
                                                   ▼
                              deploy prod (rolling) ─▶ migrations ─▶ health checks
```

- **Eval gate is a first-class CI stage**, not optional. The [dependency-inference engine](../02-agent-system/dependency-inference-engine.md) is the make-or-break subsystem; a regression in **False-Independence Rate (FIR)** or dependency precision/recall against the golden repos **blocks merge** ([testing-and-eval.md](../05-implementation/testing-and-eval.md)). This is the safety-critical gate.
- **Contract parity check** ensures the shared JSON Schemas, zod, and pydantic stay in lockstep so a Node↔Python drift can't ship silently ([tech-stack.md §7](./tech-stack.md)).
- **Images** are pinned-base, scanned (SBOM + vuln scan) per [security-and-auth.md §4.5](./security-and-auth.md), and tagged by commit SHA.
- **Rolling deploys** with health checks; failed health check halts the rollout. DB migrations are forward-compatible (expand-then-contract) so a rollback of app code doesn't break against a migrated schema.

---

## 4. Scaling posture per service

| Service | Scale signal | Notes |
|---------|--------------|-------|
| **Web** | request rate / CDN | mostly static + SSR; Realtime/WS load is on Supabase + API relay |
| **API** | request rate, WS connections | stateless; horizontal replicas behind LB; the WS log/presence **relay** is the heavier path (sticky-session or shared via Redis pub/sub) |
| **Workers — `plan-build`** | `queue:plan-build` depth | low volume, Opus-heavy, latency-sensitive (first-plan < ~30s for G2, [scope.md §8](../00-overview/scope.md)) |
| **Workers — `analysis`** | `queue:analysis` depth | per-node, Opus; fans out wide on G3/G4 — scale on backlog |
| **Workers — `node-run`** | `queue:node-run` depth | **highest-volume**, Sonnet build loop; each job spawns a sandbox; scale aggressively but bounded by per-org sandbox caps |
| **Workers — `integration`** | `queue:integration` depth | bursty at branch reconvergence; serialized per plan by `lock:branch` |
| **Workers — `replan`** | `queue:replan` depth | incremental; Opus structure + Sonnet edits |
| **Analysis svc** | request rate / CPU | **stateless behind the Redis cache** (`cache:symbolgraph`, `cache:touchset`); cache hits are cheap, cold parses are CPU-bound — scale on CPU |
| **Sandboxes** | per `node-run` job | one ephemeral microVM/gVisor per run; capped per org via `ratelimit:org:{id}` |

Each queue scales **independently** ([tech-stack.md §2](./tech-stack.md)), so a fan-out of node builds doesn't starve planning, and analysis backlog doesn't block execution. KEDA-style queue-depth autoscaling per worker pool; analysis and node-run scale to zero in preview.

---

## 5. Failure & restart semantics

Designed so **no in-flight work is lost on a worker restart** ([architecture §5](./high-level-architecture.md), [realtime-and-state.md §2](./realtime-and-state.md)):

- **Lock TTL expiry → re-queue.** Control locks (`lock:plan/branch/node`) carry a 60s TTL renewed by a live worker. A crashed worker's lock lapses, BullMQ's stalled-job check re-queues the job, and a fresh worker picks it up.
- **Idempotent runs.** The BullMQ `jobId` is the `run_id`; on pickup the worker no-ops if the `runs` row is already `succeeded` ([data-model.md §8](./data-model.md)). A re-queued node build resumes safely — worktrees are ephemeral and re-created, and the `lock:file` backstop prevents a stale and a fresh build from colliding ([realtime-and-state.md §4](./realtime-and-state.md)).
- **State survives memory.** A plan in `executing` is reconstructable purely from Postgres + Redis; workers hold no durable state. The live token stream is throwaway; the final `runs` row + archived `logs` blob are the record.
- **Claude transient failures** retry with exponential backoff; tool outputs are zod-validated with bounded repair retries ([architecture §5](./high-level-architecture.md)). Exhaustion dead-letters the job and transitions the run to `failed` (surfaced on `runs:{plan_id}`).
- **Sandbox breach/timeout** kills the sandbox and fails the run with a reason; resource-exhaustion failures are **not** blindly retried ([security-and-auth.md §4.3](./security-and-auth.md)).
- **No auto-merge on red:** integration conflicts populate `conflict_report` and wait for human adjudication ([integration-merge.md](../02-agent-system/integration-merge.md)) — a failed merge never corrupts a branch.

---

## 6. Observability

| Signal | Tool | What |
|--------|------|------|
| **Distributed traces** | **OpenTelemetry** | one trace per user action propagated **web → api → workers → analysis → Claude**; the API's `X-Request-Id` ([api-design.md §9](./api-design.md)) seeds the trace, and `run_id` is a span attribute so a run is traceable end-to-end |
| **Product + LLM cost** | **PostHog** | product analytics (plan created, run dispatched, ratification rate, thumbs-up rate) **and LLM cost** per org/model/plan from the `runs.tokens`/`runs.cost` fields ([security-and-auth.md §8](./security-and-auth.md)) |
| **Structured logs** | JSON logs → log sink | correlated by `request_id`/`run_id`/`plan_id`; live run logs are the Redis stream, archived to the `logs` bucket ([realtime-and-state.md §3](./realtime-and-state.md)) |
| **Metrics/dashboards** | OTel metrics + dashboards | queue depths per queue, worker concurrency, lock contention (`lock:file` block rate), analysis cache hit rate, Claude latency/error rate, sandbox spawn time, **FIR in prod** (sampled) |

**Key dashboards:** queue health (depth + age per queue), parallel-execution health (`lock:file` block rate, parallel-correctness, speedup vs sequential on G3 — the [success metrics](../00-overview/success-metrics.md)), LLM cost burn-down per org, and analysis-service cache hit ratio. Trace exemplars link a slow user action straight to the offending span (e.g. a cold symbol-graph parse).

---

## 7. Cost controls

- **Model routing** is the biggest lever: Opus only for plan/dependency/analysis; Sonnet for high-volume build/widgets ([tech-stack.md §6](./tech-stack.md)).
- **Prompt caching** of the repo-context block amortizes cost/latency across every call on a plan ([tech-stack.md §6](./tech-stack.md)).
- **Cache before compute:** the analysis service is content-addressed by `{project, commit}`; a cache hit avoids a re-parse entirely ([realtime-and-state.md §6](./realtime-and-state.md)).
- **Cost guards** throttle/queue dispatch as an org approaches its budget via `ratelimit:org:{id}`, with spend metered from `runs.cost` and alerted in PostHog ([security-and-auth.md §8](./security-and-auth.md)).
- **Scale-to-zero** for analysis and node-run worker pools in non-prod; sandboxes are ephemeral so idle compute is near-zero.

---

## 8. Backups & disaster recovery

| Asset | Strategy | RPO / RTO target |
|-------|----------|------------------|
| **Postgres (Supabase)** | managed continuous backup + PITR | RPO minutes / RTO < 1h |
| **Storage buckets** (`repo-index`, `diffs`, `logs`, `specs`) | managed redundancy; `specs`/`diffs` are the durable record of delegated/built work | RPO ~0 (versioned) |
| **Redis** | **treated as reconstructable** — queues/locks/streams/cache/presence are ephemeral by design | RTO minutes; in-flight jobs re-derived |
| **Repo index** | re-derivable from the source repo via re-index | rebuildable; backup is an optimization |

DR posture follows the durable/ephemeral split ([ADR-2](./high-level-architecture.md)): **Postgres + Storage are the things we must not lose**; Redis loss costs in-flight ephemeral state only. On a Redis failover, idempotent `run_id`s and the state machines ([realtime-and-state.md §8–9](./realtime-and-state.md)) let in-flight runs be re-queued from the persisted `runs` rows rather than lost. Restore drills are run on a schedule against staging.

---

## To-do list

- [ ] Containerize api/workers/analysis with pinned, scanned base images + SBOM; web on Vercel (or container) with the SSR shell.
- [ ] Provision managed Supabase (Postgres/Auth/Realtime/Storage + buckets) and managed HA Redis per environment.
- [ ] Stand up dev (docker-compose), per-PR preview (Vercel preview + branch DB), staging, and prod environments with env-var config + secrets broker.
- [ ] Build the CI pipeline: typecheck/mypy, lint/ruff, contract-parity (JSON Schema↔zod↔pydantic), unit (vitest/pytest).
- [ ] Wire the **eval gate** (FIR / precision-recall / parallel-correctness) as a merge-blocking CI stage against golden repos.
- [ ] Implement rolling deploys with health checks + expand-then-contract migrations and rollback safety.
- [ ] Configure per-queue worker autoscaling (queue-depth/KEDA), scale-to-zero in non-prod, and per-org sandbox caps.
- [ ] Make the analysis service stateless behind the Redis cache and autoscale on CPU.
- [ ] Implement lock-TTL-expiry re-queue + idempotent run resume + stalled-job recovery, verified by chaos/restart tests.
- [ ] Instrument OpenTelemetry traces web→api→workers→analysis→Claude with `request_id`/`run_id`/`plan_id` correlation.
- [ ] Wire PostHog product analytics + LLM cost (from `runs.tokens`/`runs.cost`) and structured logs to the log sink.
- [ ] Build the core dashboards: queue health, parallel-execution health (lock block rate / FIR / speedup), LLM cost burn-down, cache hit ratio.
- [ ] Implement cost guards (`ratelimit:org`) with budget alerts and model-routing/prompt-caching cost levers.
- [ ] Configure Postgres PITR + Storage redundancy; document the Redis-is-reconstructable DR runbook and schedule restore drills.

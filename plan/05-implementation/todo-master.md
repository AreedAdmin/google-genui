# Master To-Do (program rollup)

> Status: **Canonical.** The single tracking surface for the whole build. Each functional doc carries its own granular `## To-do list`; this file rolls them up by **workstream**, marks the **critical path**, and cross-references the milestones in [`milestones-and-phases.md`](./milestones-and-phases.md). Update checkboxes here at the epic level; keep fine-grained tasks in the owning doc.

## How to use
- **Workstreams (W-A … W-G)** group the work by team/skill. Each epic links to the doc holding the detailed checklist.
- **Priority:** `P0` = on the critical path / bet-the-product; `P1` = needed for a credible v1; `P2` = polish / phase 2+.
- **Milestone** column maps to `M0–M10` in [`milestones-and-phases.md`](./milestones-and-phases.md).
- Definition of done is in [`../00-overview/deliverables.md`](../00-overview/deliverables.md) (D1–D17 + acceptance criteria).

---

## Critical path (read first)
The product lives or dies on the **dependency engine** and a **thin vertical slice** proving it. Sequence to de-risk:

1. **W-A** repo onboarding + static index → **W-B** dependency engine (D4) → **W-C** planner (D3) → **W-D** graph canvas + node inspector (D9/D10) → **W-C** builder + parallel run of two independent branches (D6) → **W-B/F** False-Independence eval gate (D15).
2. Everything else (analysis depth, widgets, delegation, real-time co-edit, G3/G4 layouts) layers on that spine.

> **The one metric that gates the product: False-Independence Rate (FIR).** If "independent" branches corrupt merges, nothing else matters. See [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md) §8 and [`testing-and-eval.md`](./testing-and-eval.md).

---

## W-A — Platform, data & infrastructure
*Owner area: `01-architecture`. Detailed lists: [data-model](../01-architecture/data-model.md), [api-design](../01-architecture/api-design.md), [realtime-and-state](../01-architecture/realtime-and-state.md), [security-and-auth](../01-architecture/security-and-auth.md), [deployment-and-infra](../01-architecture/deployment-and-infra.md), [repo-structure](./repo-structure.md).*

| ✓ | Epic | Pri | Milestone |
|---|------|-----|-----------|
| [ ] | Monorepo scaffold (pnpm workspaces: web/api/workers/shared/ui/db/agent-core/git-worktree, services/analysis) | P0 | M0 |
| [ ] | Supabase schema + enums + RLS + revisions (all tables in [data-model](../01-architecture/data-model.md)) | P0 | M1 |
| [ ] | Auth (email + GitHub OAuth) + orgs/roles | P0 | M1 |
| [ ] | Redis: queues (BullMQ), locks (Redlock), streams, presence, cache keys | P0 | M1 |
| [ ] | Fastify REST surface (`/v1`) + zod validation + error/idempotency model | P0 | M1 |
| [ ] | Repo onboarding (clone/upload) + Storage buckets | P0 | M1 |
| [ ] | Trellis MCP server + `/trellis` slash command (launcher) + canvas deep-link routing ([integration-surfaces](../01-architecture/integration-surfaces.md)) | P0 | M3 |
| [ ] | `trellis login` device-link token + RLS-scoped MCP mutation re-checks | P1 | M3 |
| [ ] | Durable-vs-ephemeral wiring (Supabase Realtime feeds + Redis stream WS relay) | P0 | M3 |
| [ ] | Sandboxed worktree executor (isolation, egress deny, resource caps, secrets) | P0 | M4 |
| [ ] | CI/CD (typecheck/lint/test/eval-gate/preview) + environments | P1 | M0→ongoing |
| [ ] | Observability (OTel traces, PostHog product+LLM cost, structured logs, dashboards) | P1 | M6 |
| [ ] | Backups/DR, cost controls, rate limiting | P1 | M6 |

## W-B — Dependency engine & analysis service (the crux)
*Owner area: `02-agent-system` + Python service. Detailed list: [dependency-inference-engine](../02-agent-system/dependency-inference-engine.md).*

| ✓ | Epic | Pri | Milestone |
|---|------|-----|-----------|
| [ ] | Python analysis service skeleton (FastAPI, cache-backed, stateless) | P0 | M1 |
| [ ] | `index_repo` — tree-sitter TS/JS → symbol/import/call/type graphs | P0 | M1 |
| [ ] | `resolve-touchset` — predicted→real symbol resolution + new-symbol detection | P0 | M2 |
| [ ] | Blast-radius expansion (callers, signature call-sites, type/schema/config consumers) | P0 | M2 |
| [ ] | `overlap` + `callgraph-impact` endpoints | P0 | M2 |
| [ ] | Edge-derivation rules (Stage 4) over resolved touch-sets | P0 | M2 |
| [ ] | Independence/overlap classifier + **asymmetric-caution** defaults (Stage 5) | P0 | M2 |
| [ ] | **False-independence detector** with cited conflicts | P0 | M2 |
| [ ] | DAG builder + cycle breaking + branch partition + integration-node insertion | P0 | M2 |
| [ ] | Confidence propagation (resolution→edge→branch) | P0 | M2 |
| [ ] | Conflict-resolution strategies (serialize / split / hoist shared prereq) | P1 | M5 |
| [ ] | Drift re-derivation hook (consumes builder actual-diff) | P0 | M5 |
| [ ] | Incremental re-index on new commit | P1 | M6 |
| [ ] | Python-language grammar (phase 2) | P2 | M9 |
| [ ] | Shared JSON Schemas (pydantic ↔ zod) for touch-set/edge/overlap | P0 | M1 |

## W-C — Agent system
*Owner area: `02-agent-system`. Detailed lists: [overview](../02-agent-system/overview.md), [planner-agent](../02-agent-system/planner-agent.md), [analysis-annotation-agent](../02-agent-system/analysis-annotation-agent.md), [builder-agent](../02-agent-system/builder-agent.md), [parallel-orchestration](../02-agent-system/parallel-orchestration.md), [integration-merge](../02-agent-system/integration-merge.md), [replan-and-drift](../02-agent-system/replan-and-drift.md), [prompts-and-tools](../02-agent-system/prompts-and-tools.md).*

| ✓ | Epic | Pri | Milestone |
|---|------|-----|-----------|
| [ ] | Shared tool catalog + cached repo-context block + schema-forced outputs (zod/pydantic, repair retries) | P0 | M2 |
| [ ] | Planner agent (Opus) → Nodes + predicted touch_set + LayoutSpec; granularity detection | P0 | M2 |
| [ ] | Analysis/annotation agent (Opus) → 5 sections + WidgetSpec[], **grounded or flagged** | P0 | M3 |
| [ ] | Trust loop (feedback thumbs → suppression of noisy patterns) | P1 | M6 |
| [ ] | **Runner abstraction** (`AgentRunner`/WorkOrder/registry + `execution_backend` selection) ([agent-runners](../02-agent-system/agent-runners.md)) | P0 | M4 |
| [ ] | **Claude Code runner** (headless, stream-json, worktree cwd, CLAUDE.md/MCP guardrail injection) — **demo runner** | P0 | M4 |
| [ ] | Native runner (Sonnet) → worktree tool-loop, touch_set-bounded, streams diff/logs, test gate (built-in fallback) | P0 | M4 |
| [ ] | Boundary safety for all runners: per-branch worktree isolation + post-run diff/drift audit + Trellis-run test gate | P0 | M4 |
| [ ] | `lock:file` parallel-safety backstop + contention serialize-with-reason (native runner) | P0 | M4 |
| [ ] | Parallel orchestration (topo enqueue, ratified-only parallelism, concurrency caps, backpressure) | P0 | M5 |
| [ ] | Integration/merge agent (merge worktrees, test gate, conflict report, no auto-merge on red) | P0 | M5 |
| [ ] | Replan agent (Opus) → new plan_revision, incremental re-derivation | P0 | M5 |
| [ ] | Drift handling (re-derive affected nodes, demote-to-sequential, surface notice) | P0 | M5 |

## W-D — Generative UI (the assessed surface)
*Owner area: `03-generative-ui`. Detailed lists: [granularity-layouts](../03-generative-ui/granularity-layouts.md), [genui-philosophy](../03-generative-ui/genui-philosophy.md), [graph-canvas](../03-generative-ui/graph-canvas.md), [node-inspector](../03-generative-ui/node-inspector.md), [widget-generation](../03-generative-ui/widget-generation.md), [component-library](../03-generative-ui/component-library.md), [realtime-ui](../03-generative-ui/realtime-ui.md), [collaboration-ui](../03-generative-ui/collaboration-ui.md).*

| ✓ | Epic | Pri | Milestone |
|---|------|-----|-----------|
| [ ] | Design system / component library (Tailwind + shadcn, tokens, status/edge visual language, a11y) | P0 | M3 |
| [ ] | Graph canvas (React Flow): node faces by change_type/status, typed edges + evidence-on-hover | P0 | M3 |
| [ ] | LayoutSpec schema + validator + safe fallback | P0 | M3 |
| [ ] | **G2 compact_dag layout** (sweet-spot first) | P0 | M3 |
| [ ] | Node inspector: 5 sections + action bar (Run/Share/Delegate/Add context) + citations | P0 | M3 |
| [ ] | WidgetSpec schema + registry + double-validation + FallbackWidget | P0 | M3 |
| [ ] | 4 MVP widgets: schema-diff, api-contract, component-preview, call-graph-impact | P0 | M3 |
| [ ] | **G1 diff-first** + **G3 swimlane** + **G4 zoomable map** layouts + semantic zoom/minimap | P1 | M7 |
| [ ] | Ratify/add/split-edge interactions (engine Stage 7 handshake) | P0 | M5 |
| [ ] | "Dispatch parallel" + per-branch run controls | P0 | M5 |
| [ ] | Real-time UI: realtime subs + stream relay, optimistic edits + reconcile, re-flow animation, streamed analysis | P0 | M5 |
| [ ] | Phase-2 widgets (key-diff, test-linkage, resource-diagram, markdown/checklist) | P2 | M9 |
| [ ] | Density controls, responsive degrade-to-list, full a11y pass | P1 | M8 |
| [ ] | Visual-regression suite (tier × change-type) | P1 | M8 |

## W-E — Collaboration & delegation
*Owner area: `04-collaboration-delegation`. Detailed lists: [sharing-model](../04-collaboration-delegation/sharing-model.md), [subtree-delegation](../04-collaboration-delegation/subtree-delegation.md), [multi-user-sync](../04-collaboration-delegation/multi-user-sync.md), UI in [collaboration-ui](../03-generative-ui/collaboration-ui.md).*

| ✓ | Epic | Pri | Milestone |
|---|------|-----|-----------|
| [ ] | Sharing model + RLS (viewer/runner/editor) + invites/links/revocation | P1 | M7 |
| [ ] | **Subtree delegation:** portable-spec format + export + recipient mini-plan | P0 | M7 |
| [ ] | Merge-back of a returned subtree (via integration node) | P1 | M7 |
| [ ] | Presence + multi-user optimistic sync + edit/run locking | P1 | M6 |
| [ ] | Activity/audit feed + notifications | P2 | M8 |
| [ ] | CRDT/Yjs co-editing (only if triggered — see [open-questions](../06-appendix/open-questions.md) OQ-01) | P2 | post-v1 |

## W-F — Quality, eval & safety
*Owner area: `05-implementation`. Detailed list: [testing-and-eval](./testing-and-eval.md).*

| ✓ | Epic | Pri | Milestone |
|---|------|-----|-----------|
| [ ] | Golden-repo eval harness + hand-labeled dependency graphs | P0 | M2→ongoing |
| [ ] | **FIR (primary), dependency precision/recall, parallel-merge-clean** metrics | P0 | M2 |
| [ ] | Adversarial case suite (hidden config, transitive types, same-file disjoint, migration order, dynamic dispatch) | P0 | M5 |
| [ ] | Analysis grounding-rate + hallucination-rate eval | P1 | M6 |
| [ ] | Parallel-speedup measurement (G3) | P1 | M5 |
| [ ] | Unit/integration/e2e (Playwright) + cross-language contract tests | P1 | ongoing |
| [ ] | Widget schema-fuzzing + a11y checks | P1 | M8 |
| [ ] | CI gates (which metrics block merge) | P0 | M2→ongoing |
| [ ] | Online→offline golden-case harvest loop | P2 | M6 |

## W-G — Demo & launch
*Owner area: `05-implementation` / `00-overview`. See [deliverables](../00-overview/deliverables.md) D17, [milestones](./milestones-and-phases.md) M10.*

| ✓ | Epic | Pri | Milestone |
|---|------|-----|-----------|
| [ ] | Demo fixtures: one plan per tier (G1–G4) | P0 | M10 |
| [ ] | Scripted end-to-end demo per [demo-script.md](./demo-script.md): plan → grounded analysis → parallel dispatch of two independent branches → integration → subtree delegation → real-time re-plan | P0 | M10 |
| [ ] | Phase A (internal/dogfood) rollout on real repos | P0 | M6 |
| [ ] | Phase B (design-partner customer-facing) hardening | P1 | M8 |
| [ ] | Phase C (platform/embeddable) exploration | P2 | post-v1 |

---

## Program-level definition of done
- All **P0** epics complete; D1–D16 acceptance criteria met; **D17 demo** runs clean across G1–G4.
- **FIR** meets the target in [`testing-and-eval.md`](./testing-and-eval.md); eval CI gates green.
- No open **P0** items in [`../06-appendix/open-questions.md`](../06-appendix/open-questions.md) (currently OQ-07, the FIR target, is the lone P0 to resolve).

## Health snapshot (update as we go)
| Workstream | P0 epics | Status |
|------------|----------|--------|
| W-A Platform | 8 | `TODO` |
| W-B Dependency engine | 11 | `TODO` |
| W-C Agents | 9 | `TODO` |
| W-D Generative UI | 9 | `TODO` |
| W-E Collaboration | 1 | `TODO` |
| W-F Quality/eval | 5 | `TODO` |
| W-G Demo | 3 | `TODO` |

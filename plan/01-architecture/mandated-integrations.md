# Mandated Integrations — CopilotKit · AG-UI · A2A · Linkup

> Status: **Canonical.** A second mandate (after Supabase/Redis/Claude/JS-or-Python in [tech-stack.md](./tech-stack.md)) requires four libraries: **CopilotKit**, **AG-UI**, **A2A**, and **Linkup**. This doc is the single source of truth for *what role each plays*, *where it integrates*, and — critically — *what it does **not** replace*. It amends [tech-stack.md](./tech-stack.md), [realtime-and-state.md](./realtime-and-state.md), and [integration-surfaces.md](./integration-surfaces.md); it does **not** alter any of the four product pillars (see [§7](#7-impact-on-the-four-pillars)).

## TL;DR

These four are **additive protocol/UI layers**, not a re-platform. The thesis ("the agent's output is software, not an answer" — an interactive DAG canvas) is unchanged. They map onto seams the plan already has: the agent→canvas delivery layer, the pluggable runner + subtree-delegation pillar, and the agent tool-belt. **No pillar is lost; P3 is strengthened; P4's delivery transport is rewired.**

---

## 1. Decision summary

| Library | Layer | Role in Trellis | Integrates with (existing) | Does **NOT** replace | Key decision |
|---------|-------|-----------------|----------------------------|----------------------|--------------|
| **AG-UI** | agent ↔ frontend protocol | Standard event stream (state snapshots/deltas, tool calls, lifecycle, tokens) from a running agent to the canvas | The custom run-streaming path in [realtime-and-state.md §3](./realtime-and-state.md) | **Supabase Realtime** (stays the durable, multi-user truth plane) | Adopt AG-UI as the **live agent-interaction transport**; emit AG-UI events from our **bespoke** agent loop ([§5](#5-the-agent-runtime-decision-bespoke--ag-ui-emitter)). |
| **CopilotKit** | frontend (React) | Consumes AG-UI; holds live agent/plan state via `useCoAgent`; human-in-the-loop ratify/dispatch via `useCopilotAction`; **renders into the React Flow canvas** | `apps/web` (Next.js/React Flow/Zustand) | **React Flow, the widgets, the G1–G4 layouts** (CopilotKit *feeds* them) | **Canvas-primary, headless mode.** No chat-first UX. Optional thin sidebar for real-time plan iteration only ([§6](#6-copilotkit-usage-rules)). |
| **A2A** | agent ↔ agent protocol | Standard task hand-off to *external* agents: the **pluggable runner** and **subtree delegation** | [agent-runners.md](../02-agent-system/agent-runners.md), [subtree-delegation.md](../04-collaboration-delegation/subtree-delegation.md) | **BullMQ** (internal durable queueing/orchestration — a different layer) | Use A2A for the **runner boundary + delegate-to-agent** path. Generalizes "v1 runner = Claude Code" to "any A2A remote agent." TS SDK (`@a2a-js/sdk`) in the Node layer. |
| **Linkup** | agent tool | External web-search/grounding tool in the agent tool-use loop (library docs, deprecations, API references, best practices) | [prompts-and-tools.md](../02-agent-system/prompts-and-tools.md), the Claude tool-use loop | The **Python analysis service** (repo-symbol grounding) | Add as a tool, **clearly separated** from repo-symbol grounding so the "grounded in real symbols" guarantee is not diluted ([§3.3](#33-linkup--external-grounding-kept-separate-from-repo-grounding)). |

---

## 2. The mental model: three protocols, three directions

Trellis now speaks the modern agent-protocol "trinity," each on its own axis — they compose, they don't compete:

```
        ┌─────────────────────────── the canvas (apps/web) ───────────────────────────┐
        │  React Flow DAG · node inspector · widgets · live run console                │
        └──────────────────────────────────▲───────────────────────────────────────────┘
                                            │  AG-UI events  (agent ↔ USER)
                                            │  via CopilotKit  useCoAgent / useCopilotAction
        ┌───────────────────────────────────┴──────────────────────────────────────────┐
        │  Orchestration (apps/api + apps/workers)  — bespoke Anthropic-SDK agent loop   │
        │  Planner · Dependency engine · Analysis · Replan      [BullMQ queues, Redis]   │
        └───────┬───────────────────────────────────────────────────────┬──────────────┘
   MCP (agent ↔ TOOLS) │                                    A2A (agent ↔ AGENT) │
   Linkup, analysis svc,│                                    pluggable runner +  │
   file/git/test tools  ▼                                    subtree delegation  ▼
        ┌──────────────────────────┐                    ┌───────────────────────────────┐
        │ Python analysis service  │                    │ Coding runner (Claude Code…)  │
        │ Linkup search · repo idx │                    │ or another user's Trellis/agent│
        └──────────────────────────┘                    └───────────────────────────────┘
```

- **AG-UI** = agent ↔ **user** (drives the generative UI). CopilotKit is its React client.
- **MCP** = agent ↔ **tools** (already in the plan — Linkup rides here, alongside the analysis service).
- **A2A** = agent ↔ **agent** (the runner boundary + delegation).

---

## 3. Architectural deltas

### 3.1 Agent ↔ frontend: AG-UI + CopilotKit, **hybrid** with Supabase Realtime

The single most important integration. Today, [realtime-and-state.md](./realtime-and-state.md) defines a custom delivery split: **Supabase Realtime** for durable state + a **Redis-Streams WS relay** for ephemeral tokens/logs/diffs. AG-UI overlaps the *second* of those. The resolution is a deliberate **two-plane hybrid**, not a replacement:

| Concern | Carried by | Why |
|---------|-----------|-----|
| Durable, multi-user, reload-survivable truth (plan/nodes/edges/runs, presence, RLS, reconnect-with-resume, collaboration) | **Supabase Realtime** (unchanged) | A single AG-UI session is per-client and per-run; it does not give multi-tenant durable truth, presence, or share-grant scoping. Keep what the plan already designed. |
| Live agent interaction for the **active plan/run** the user is operating (state snapshot/delta, tool-call surfacing, token/diff stream, human-in-the-loop prompts) | **AG-UI → CopilotKit** | This is exactly AG-UI's job; CopilotKit's `useCoAgent` holds the streamed state and renders it into the canvas. |

Rule of thumb (refines [realtime-and-state.md §7](./realtime-and-state.md)): **AG-UI for the agent conversation you're in right now; Supabase Realtime for the durable graph everyone shares.** **Resolved (Option B):** the raw token/diff/log firehose stays on the existing **Redis-Streams relay** ([realtime-and-state.md §3](./realtime-and-state.md)) — it keeps resumable replay (`XREAD` from `?from=`), multi-watcher fan-out, `MAXLEN` trimming, and archive-on-completion, none of which AG-UI/CopilotKit provide for free. AG-UI carries only the **structured** events (state snapshot/delta, lifecycle, tool calls, agent narration); the live build console is a **CopilotKit-rendered component** that opens the WS relay for the active `run_id`, so the UX is unified even though the transport is split by job. *(Option A — routing the firehose as AG-UI custom events — was rejected: it couples high-frequency logs to the copilot session and forgoes the relay's resumable/fan-out guarantees.)*

### 3.2 Agent ↔ agent: A2A for the runner boundary + delegation (not BullMQ)

A2A is an **interop** protocol; BullMQ is a **durable in-house queue**. They live at different layers — do not collapse them.

- **Internal orchestration** (planner → dependency → analysis → integration, retries, idempotency, locks) **stays on BullMQ** exactly as in [realtime-and-state.md §2](./realtime-and-state.md).
- **The runner boundary becomes A2A.** The orchestrator is the A2A **client**; the coding runner is an A2A **remote agent** exposing an Agent Card. This is the clean realization of the plan's "execution is a pluggable, user-selectable runner" decision ([agent-runners.md](../02-agent-system/agent-runners.md)) — Claude Code (v1) becomes *one* A2A runner; any A2A-speaking agent can be swapped in.
- **Subtree delegation becomes an A2A task hand-off.** [subtree-delegation.md](../04-collaboration-delegation/subtree-delegation.md)'s "export a subtree as a portable spec and hand it to another user/agent" *is* an A2A task: the portable spec is the A2A message/artifact; status flows back over A2A's task lifecycle (with our `delegations.return` integration step unchanged).
- **SDK & placement (resolved):** use the **TypeScript A2A SDK (`@a2a-js/sdk`)**, hosted in the Node `apps/api` / `apps/workers`. The A2A *client* (initiator) is the orchestration layer, which is already TypeScript — so it shares the `@trellis/shared` zod contracts and one runtime/deploy story (consistent with [tech-stack.md §2 & §8](./tech-stack.md)). A2A is a wire protocol, so remote runners can still be any language. *(The Python `a2a-sdk` is the more feature-complete reference implementation today; revisit only if Trellis later needs to **host** an advanced A2A server and the JS SDK lags.)*

### 3.3 Linkup — external grounding, kept separate from repo grounding

Linkup is a **tool** in the Claude tool-use loop, registered alongside the analysis-service endpoints in [prompts-and-tools.md](../02-agent-system/prompts-and-tools.md). It answers *world* questions (is this library deprecated? what's the current API? known footguns?), used mainly by the **Planner** and **Analysis/Annotation** agents.

> **Guardrail:** Trellis's trust comes from grounding in **real repo symbols** (P2). Linkup adds *external* grounding, which must be **labelled distinctly** in annotations (e.g. an annotation's evidence is tagged `repo-symbol` vs `web:linkup` with source URLs) so external claims never masquerade as verified repo facts. See the analysis/annotation revision in [§9](#9-doc-revision-checklist).

---

## 4. AG-UI event ↔ Trellis state mapping

The bespoke agent loop emits the standard AG-UI events; CopilotKit consumes them and the reducer projects them onto the canvas:

| AG-UI event(s) | Trellis meaning | Canvas effect |
|----------------|-----------------|---------------|
| `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR` | a plan-build / node-run / replan run lifecycle | run badge + console state |
| `STEP_STARTED` / `STEP_FINISHED` | planner/dependency/analysis stage boundaries | progress affordance on the plan |
| `STATE_SNAPSHOT` | full current plan (nodes/edges/branches) | initial canvas hydrate for the active agent session |
| `STATE_DELTA` (JSON-Patch) | incremental plan mutation (node added, edge derived, annotation attached) | live DAG morphing; reconciles against the optimistic-UI rule ([realtime-and-state.md §7](./realtime-and-state.md)) |
| `TEXT_MESSAGE_*` | agent narration / rationale | inspector reasoning pane, not a chat transcript |
| `TOOL_CALL_*` + `TOOL_CALL_RESULT` | agent calling analysis svc / Linkup / git / tests | tool-activity indicators; widget data |
| custom/raw events | token & diff chunks for the live build console | streamed-diff viewer (may sit on the existing Redis-Streams relay) |

The **durable** projection of these still lands in Postgres and re-broadcasts on Supabase Realtime for other collaborators — AG-UI feeds the *operator's* live view; Supabase keeps it true for everyone else.

---

## 5. The agent-runtime decision: bespoke + AG-UI emitter

**Decision (confirmed):** keep the bespoke Anthropic-SDK agent loop. **Do not** reverse the [tech-stack.md §8](./tech-stack.md) rejection of LangChain/LangGraph.

- AG-UI's smoothest first-party integrations assume a framework (LangGraph/CrewAI/Pydantic-AI). We forgo that convenience deliberately.
- Instead we implement a thin **AG-UI event emitter** over our own loop: the orchestration layer publishes the standard AG-UI event types ([§4](#4-ag-ui-event--trellis-state-mapping)) over SSE/WebSocket from a `/agent` endpoint that CopilotKit's runtime points at.
- Cost: we own the emitter (moderate wiring) and its conformance tests. Benefit: the orchestration, evaluation harness, and the §8 rationale (small bespoke agent graph, clearer to evaluate) are all preserved.

This keeps §8 intact while fully honoring the AG-UI mandate.

---

## 6. CopilotKit usage rules

> **Assumption (override if wrong):** the canvas stays primary — Trellis is *not* becoming a chat-first copilot. This preserves the core thesis ([plan README](../README.md)). Confirm with the stakeholder/grader if a chat-first UX was actually intended; that would be a product pivot, not an integration.

- **Mode:** headless / agentic. Use `useCoAgent` for shared plan/run state and `useCopilotAction` (with `renderAndWaitForResponse`) for human-in-the-loop **ratify / dispatch / delegate** prompts rendered *as canvas affordances*.
- **Generative UI:** render agent state into the **React Flow canvas and the existing widget registry** — never raw model HTML (consistent with [widget-generation.md](../03-generative-ui/widget-generation.md)).
- **Do not** mount `<CopilotChat>`/`<CopilotSidebar>` as the primary surface. A **thin sidebar is permitted for one job only**: conversational *plan iteration* ("split this node", "what if we defer auth?") — which maps to `POST /plans/:id/replan` and fits P4's "iterate in real time." The DAG remains home.

---

## 7. Impact on the four pillars

| Pillar | Impact | Net |
|--------|--------|-----|
| **P1 Plan Graph (DAG)** | None — produced by the same planner/dependency engine. | unchanged |
| **P2 Grounded Analysis** | Linkup adds *external* grounding alongside repo-symbol grounding; must be labelled distinctly ([§3.3](#33-linkup--external-grounding-kept-separate-from-repo-grounding)). | enriched |
| **P3 Parallel Execution & Delegation** | A2A becomes the runner boundary + delegation transport. | **strengthened** |
| **P4 Context-Adaptive Generative UI** | Delivery transport rewired to AG-UI + CopilotKit; the canvas/widgets/layouts themselves are unchanged. | unchanged (re-plumbed) |

---

## 8. What this explicitly does NOT change

- The **product thesis**, the **four pillars**, and the **G1–G4 granularity model**.
- The **mandated base stack** (Supabase, Redis, Claude, Next.js + Python) and the **monorepo layout**.
- **BullMQ** internal orchestration, the **lock layer**, **idempotency**, and the **state machines** ([realtime-and-state.md §2,§4,§8,§9](./realtime-and-state.md)).
- **React Flow**, the **node inspector**, the **widget registry**, and the **layout engines**.
- The **MCP server + `/trellis` launcher** ([integration-surfaces.md](./integration-surfaces.md)) — MCP stays the agent↔tools axis; Linkup is just a new tool on it.

There is **no case for starting the repo fresh**: every constraint is additive to seams that already exist.

---

## 9. Doc-revision checklist

Downstream canonical docs to reconcile with this one (follow-up edits):

- [x] [tech-stack.md](./tech-stack.md) — four libs added to the stack table; §8 amended (AG-UI adopted *without* a framework).
- [x] [../README.md](../README.md) — mandate registered in "Canonical decisions."
- [x] [realtime-and-state.md](./realtime-and-state.md) — AG-UI plane + two-plane hybrid rule noted (§3.1). *Resolved (§3.1):* the raw token/diff/log firehose stays on the **Redis-Streams relay** (Option B); AG-UI carries structured state + agent narration.
- [x] [../03-generative-ui/realtime-ui.md](../03-generative-ui/realtime-ui.md) + [genui-philosophy.md](../03-generative-ui/genui-philosophy.md) — CopilotKit `useCoAgent`/`useCopilotAction` as the canvas state/HITL mechanism (§6).
- [x] [../03-generative-ui/widget-generation.md](../03-generative-ui/widget-generation.md) — CopilotKit generative-UI rendering against the registry (§6).
- [x] [../02-agent-system/agent-runners.md](../02-agent-system/agent-runners.md) — runner boundary = A2A; Claude Code = one A2A remote agent.
- [x] [../02-agent-system/parallel-orchestration.md](../02-agent-system/parallel-orchestration.md) — BullMQ (internal) vs A2A (runner) boundary clarified.
- [x] [../04-collaboration-delegation/subtree-delegation.md](../04-collaboration-delegation/subtree-delegation.md) — delegation = A2A task hand-off; portable spec = A2A artifact.
- [x] [../02-agent-system/prompts-and-tools.md](../02-agent-system/prompts-and-tools.md) + [analysis-annotation-agent.md](../02-agent-system/analysis-annotation-agent.md) — Linkup tool + `repo-symbol` vs `web:linkup` evidence tagging.
- [x] **Deps installed** (pnpm, implemented against the real type defs): `@copilotkit/react-core@1.60.1` + `@ag-ui/client`/`@ag-ui/core@0.0.57` (apps/web), `@ag-ui/core` (apps/api), `@a2a-js/sdk@0.3.13` + `linkup-sdk@3.2.5` + `@ag-ui/core` (apps/workers). `ExecutionBackend` enum gains `a2a_remote`.

### Implementation status (code) — typechecks clean (`pnpm -r typecheck`)

| Concern | Code |
|---|---|
| **AG-UI emit** | `apps/workers/src/gui-stream.ts` (`GuiStream` → `stream:gui:{plan}`); emit points in `workers/plan-build.ts` (RUN_STARTED / STATE_SNAPSHOT / RUN_FINISHED) and `workers/node-run.ts` (RUN_STARTED / CUSTOM `node_status` / RUN_FINISHED); `keys.guiStream`. |
| **AG-UI transport** | `apps/api/src/routes/agui.ts` — SSE relay of `stream:gui:{plan}` at `GET\|POST /v1/plans/:id/agui`. |
| **CopilotKit + AG-UI client** | `apps/web/components/Providers.tsx` (headless `<CopilotKit>`), `apps/web/lib/agui.ts` (`useAgentStream` via `@ag-ui/client` `HttpAgent` → React Query cache), wired in `CanvasPage.tsx`. |
| **A2A** | `apps/workers/src/runners/a2a.ts` (`A2aRemoteRunner`), registered in `runners/index.ts`; `A2A_RUNNER_CARD_URL`. |
| **Linkup** | `apps/workers/src/agents/linkup.ts` (`webSearch`, `web:linkup`-tagged), wired into `agents/planner.ts`. |

> **Not yet verified at runtime** (needs the live stack — Supabase/Redis/keys): end-to-end render. **Productionization next steps:** a CopilotRuntime endpoint for full `useCoAgent`/`useCopilotAction` HITL; richer `STATE_DELTA` (vs full snapshot); precise A2A message-part mapping + Agent Card for the runner.

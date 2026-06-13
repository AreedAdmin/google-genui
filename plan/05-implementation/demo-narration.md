# Demo Narration — live presenter script

> Companion to [`demo-script.md`](./demo-script.md). That doc is the full run-of-show; this one is
> the **spoken narration** for the short live walkthrough: show the front page → write a plan →
> talk technically while it loads → narrate each stage (graph, sidebar, add-context, run all).
>
> Convention: 🖱 = what you do · 🎤 = what you say · 🔧 = under-the-hood note (for Q&A).
> Bolded phrases are the ones to land on. All claims are grounded in the real architecture
> (see [`../01-architecture/high-level-architecture.md`](../01-architecture/high-level-architecture.md)
> and [`../../docs/architecture.html`](../../docs/architecture.html)).

---

## 0 · Front page (≈15s)
🖱 *Land on the home / plan list.*

🎤 *"This is Trellis. Every coding assistant today gives you one of two things — a chat answer, or
a single diff it then builds top-to-bottom. Trellis gives you a third thing: **a plan you can
operate.** Watch — I'll describe a real change and instead of code, I get an interactive control
surface over the work."*

## 1 · Write the plan (≈10s)
🖱 *Type the prompt, e.g.* `Add "Sign in with Google and GitHub" to the login page` *and submit. The
canvas goes into its loading state.*

🎤 *"I'm describing this in plain English — no flags, no config. And while it plans, let me tell you
what's actually happening behind this spinner…"*

---

## 2 · 🌀 While it's loading — the technical talk

> Built as **three beats** so it fills whatever the load takes — stop the moment the graph pops in.
> Beat 1 always; Beats 2–3 only if it's still spinning.

### Beat 1 — the thesis + what's running right now (≈30s)
🎤 *"The governing principle of Trellis is one line: **LLMs propose and explain; deterministic
services enumerate and decide.** So right now an **Opus 4.8 planner** is reading my repo and
proposing a coarse set of 'touch-sets' — roughly which files and symbols this change hits. It can
even call a **web-search tool** mid-plan for external knowledge — library deprecations, current
OAuth APIs — but those are tagged as hints, never mixed with your real code.*

*Here's the key part: **the model never decides the dependency graph.** The moment it proposes
touch-sets, it hands off to a **deterministic dependency engine** and a **Python analysis service** —
tree-sitter to parse the real symbols, networkx to walk the graph — and *that* is what computes
which pieces actually overlap and which are truly independent."*

### Beat 2 — why that split matters (≈25s, if still loading)
🎤 *"Why bother splitting it that way? Because dependency reasoning is exactly where LLMs hallucinate
confidently. So we make it **provable, not plausible.** Every claim you're about to see is grounded
in a real `file#symbol` from the repo, or it's flagged low-confidence — no hand-waving.*

*And the engine is deliberately **asymmetrically cautious**: a false *dependency* only costs us a
little parallelism, but a false *independence* costs a corrupted merge. So when it's unsure, it
**asserts a dependency** and runs that part sequentially. We'd rather be a little slower than merge
garbage."*

### Beat 3 — the stack, fast (≈20s, only if really slow)
🎤 *"Architecturally it's a five-layer cake. The UI is **Next.js and React Flow**. The API is a thin
**Fastify** control plane that does one thing — validate, persist, enqueue, return — it never blocks
on agent work. Behind it a **BullMQ** worker fleet does the heavy lifting. **Supabase Postgres** is
the durable source of truth, row-level-secured per org; **Redis** carries the queues, locks, and
live run streams; and every build runs on its own **isolated git worktree.** That decoupling is what
lets the next part fan out safely."*

---

## 3 · 📊 The graph builds (≈30s)
🖱 *The DAG renders — nodes in tinted lanes, edges between them.*

🎤 *"And there it is — not a wall of text, a **dependency graph of the change.** A few things to read
off it:*
- *The **layout is generated for the size of the work** — this is a meso-sized feature, so it chose
  a compact left-to-right DAG. A one-line fix would've collapsed to a diff; a 50-node migration
  would be a zoomable map.*
- *Each node is **colored by change type** — a migration, an endpoint, a UI change.*
- *And see these **two tinted lanes?** Those are the branches the engine **proved are independent** —
  they touch disjoint files. That's the parallelism, computed from your actual symbol graph, not
  guessed."*

🔧 **Under the hood:** the Planner's output is now persisted in **Supabase Postgres** (`plan_nodes`,
`plan_edges`, `branches`), and the worker `XADD`-ed an **AG-UI** `STATE_SNAPSHOT` to the **Redis**
stream `stream:gui:{plan_id}`. Fastify relays that over **SSE** (`/v1/plans/:id/agui`); the canvas
consumes it via `@ag-ui/client` and React Flow draws the graph — *the agent's state is what renders
the DAG.* In the same step it enqueued one **`analysis-jobs`** job per node onto Redis — that's what
fills the sidebar next. (See the *three-plane* model in the appendix.)

## 4 · 🔬 The sidebar — node inspector (≈40s)
🖱 *Click a node (e.g. the migration). The inspector opens.*

🎤 *"Click any node and this is where the grounding shows up. Every node carries **five sections** —
**Changes, Assumptions, Analysis, Benefits, and Notable Symbols** — and on top, a **widget tuned to
the change type**: a migration shows a **schema diff**, an endpoint shows an **API contract**, a
logic change shows its **call-graph blast radius.** Same five sections everywhere, but the body
adapts to what the change *is* — that's generative UI on a second axis.*

*Now watch the claims —"* 🖱 *hover a citation.* *"— every assumption links into a **real symbol in my
repo.** This isn't the model asserting a race condition exists; it's pointing at the actual
`sessions` table it's reasoning about. If a claim leaned on a web source, it's marked **`web:linkup`**
and rendered distinctly, so external hints never masquerade as verified facts. And it's honest —"*
🖱 *thumbs-down a weak claim* *"— I can reject one, it greys out, and that feedback tunes future
analysis."*

🔧 **Under the hood:** these cards come from the **analysis worker** (BullMQ, concurrency 4) running a
second **Opus 4.8** agent per node — it calls the **Python analysis service** for the real
call-graph/blast-radius, can hit **Linkup** for external facts, and upserts a `node_annotations` row
in Postgres. The canvas learns about it two ways: **Supabase Realtime** pushes the row change →
React Query invalidates → refetch; and a **2.5s poll** (`usePlanGraph`) backstops it until every node
has its annotation. That's why they pop in progressively — and why a reload still shows them (they're
durable in Postgres, not just streamed).

## 5 · ➕ Adding new context (≈35s)
🖱 *Open* **"Add context · re-plan"** *and type a correction, e.g.* `We also need to store the
provider refresh token`.

🎤 *"Plans aren't one-shot. Say I realize we need to persist the refresh token. I don't start over — I
**add context and re-plan.**"* 🖱 *Submit; the graph re-flows.*

*"And here's what's important about how that works under the hood: it's **non-destructive and
versioned.** It doesn't mutate the existing plan — it spins up a **new revision.** A dedicated
re-plan worker re-runs the planner with my **original prompt, plus this new context, plus the current
nodes**, writes a fresh set of nodes and edges at the next revision number, and bumps the plan's
`current_revision`. The canvas re-flows to the new graph, but **every prior revision stays as
history** — its nodes, runs, and diffs are all preserved. So you can iterate on a plan the way you'd
iterate on a branch, without losing where you came from."*

🔧 **Under the hood:** this is the **`replan` worker** ("Flow C"). The "Add context · re-plan" dialog
— *or* the headless **CopilotKit** `revise_plan` action — `POST`s `/v1/plans/:id/replan`, which
enqueues a `replan` job on Redis. The worker re-runs the Planner with *original prompt + your context
+ current nodes*, writes a fresh node/edge/branch set at `target_revision`, bumps
`plans.current_revision`, logs a `plan_revisions` row, and emits a new AG-UI `STATE_SNAPSHOT`.
`getPlanGraph` reads `current_revision`, so the canvas re-flows while prior revisions stay queryable
as history.

## 6 · ⚡ Run all / Dispatch parallel (≈40s)
🖱 *Click* **"Dispatch parallel"** *(or **"Run all"**).*

🎤 *"Now I ratify it and execute. Notice the button says **'Dispatch parallel'** — because Trellis
found independent clusters, it's offering to run them concurrently. When I click it, each independent
branch is handed to a **Claude Code builder on Sonnet 4.6**, and — this is the crucial bit — **each
one runs on its own isolated git worktree.** No shared mutable state, so there's **nothing to
conflict.***

*The **diffs stream back live** as the agents work."* 🖱 *gesture at streaming nodes.* *"Anything the
engine marked dependent waits its turn — it won't start a node until its parents are green. And when
the branches finish, an **integration node reconverges them behind a test gate**: it only merges if
the tests pass. That's the asymmetric caution paying off — the stuff we weren't *sure* was
independent ran sequentially, so the parallel merge is safe by construction."*

🔧 **Under the hood:** "Dispatch parallel" enqueues a **`node-run`** job per independent node (BullMQ,
concurrency = `MAX_CONCURRENT_BRANCHES`). Each runs the **Claude Code runner**: it
`git worktree add --detach`s a fresh isolated tree at the base commit, drops a `CLAUDE.md` fencing the
agent to the node's touch-set/assumptions/risks, and spawns `claude -p … --output-format stream-json
--model sonnet-4-6`. Every token / tool-call / file-edit is `XADD`-ed to the **Redis**
`stream:run:{run_id}` firehose → SSE → the live log. On finish it harvests `git diff` (**drift-audited**
against the predicted files) into Postgres. The **`integration` worker** then takes a Redis
`lock:plan:{id}`, `git merge --no-ff`s each branch in turn, runs the **test gate** (`npm test`), and
commits the merge *only if it's green*. (A node can alternatively be dispatched to a remote **A2A**
agent instead of the local runner — same WorkOrder, different boundary.)

🎤 *(closer)* *"So that's the whole loop — **Describe, Plan, Inspect, Iterate, Operate** — and any
subtree here I could **delegate** to a teammate or another agent. The agent's output isn't an answer.
It's **software you can operate.**"*

---

## Quick-glance cue card

| Stage | One-liner to land | Under-the-hood hook |
|---|---|---|
| Loading | "LLMs propose & explain; deterministic services enumerate & decide" | Opus planner → touch-sets → engine + tree-sitter/networkx |
| Graph | "Provable parallelism, not guessed" | Independent lanes from the real symbol graph |
| Sidebar | "Every claim cites a real `file#symbol`" | Per-node Opus analysis agent, streamed live |
| Add context | "Iterate like a branch — non-destructive, versioned" | New revision, `current_revision` bump, history kept |
| Run all | "Isolated worktrees → nothing to conflict" | Sonnet builders, live diffs, integration test gate |

---

## Fallback lines (if a live run stalls)
- *Planner slow:* lean into Beat 2/3 of the loading talk — the safety model and stack are the most
  technical, credibility-building part anyway.
- *A build hangs on dispatch:* *"These are real agents on real worktrees, so latency is real — the
  point is the **shape**: independent work running concurrently, dependent work gated."* Then cut to
  a pre-built green plan if needed.

---

## 🛠️ Under the hood — what each part of the stack is doing

> Deep-dive reference for the narration above and for Q&A. The one mental model that ties it all
> together is the **three-plane data flow** — hold it in your head and every "what's X doing?"
> question answers itself.

### The three planes (say this if asked "how does the canvas stay live?")

1. **Durable truth — Supabase Postgres.** Every real entity
   (`plans → plan_nodes → node_annotations`, `plan_edges`, `branches`, `runs`, `plan_revisions`,
   `delegations`, `shares`) lives here, org-scoped by **row-level security**. It's the multi-user,
   reload-survivable source of truth. The browser hears about durable changes via **Supabase
   Realtime** (`postgres_changes` on `plan_nodes/edges/runs/branches`) → it invalidates the
   React-Query cache → refetches `GET /v1/plans/:id`. A **2.5s poll** backstops Realtime so nothing
   stalls in dev.
2. **Live agent → canvas — AG-UI over Redis Streams.** While an agent works, workers emit structured
   **AG-UI** events (`@ag-ui/core`: `RUN_STARTED`, `STATE_SNAPSHOT`, `CUSTOM node_status`,
   `RUN_FINISHED`) to the Redis stream `stream:gui:{plan_id}`. Fastify relays them as **SSE** at
   `/v1/plans/:id/agui`; the web consumes them with `@ag-ui/client`'s `HttpAgent` and projects the
   snapshot into the canvas. This is what makes the graph *draw itself*. **CopilotKit is headless** —
   the agent's *state* renders React Flow; there is no chat-first UI.
3. **Raw run firehose — Redis Streams.** The detailed execution trace (every token, tool call, file
   edit, token-usage) is a separate plane on `stream:run:{run_id}`, relayed via SSE
   `/v1/runs/:id/stream` to the live log overlay. It's **ephemeral** — the durable record of a run is
   the `runs` row in Postgres.

Why split them? Durable + multi-user needs Postgres/RLS; live-and-fast needs Redis/SSE; mixing them
would make the canvas slow *or* the firehose un-collaborative. (`mandated-integrations.md §3.1`.)

### What each technology is doing

| Stack | Role | Concretely |
|---|---|---|
| **Next.js 15 + React Flow** | The generative canvas | Renders the DAG; hydrates from AG-UI snapshots + React-Query (Realtime/poll) |
| **Fastify** (`apps/api`) | Thin control plane | `validate → persist → enqueue → return`; never blocks on agents; hosts MCP, the CopilotKit runtime, and the SSE relays |
| **Redis** | Queues · streams · locks | BullMQ job queues; the two SSE event streams (`stream:gui:*`, `stream:run:*`) via `XADD`/`XREAD BLOCK`; integration mutex `lock:plan:{id}` (`SET NX EX 600`) |
| **BullMQ** (`apps/workers`) | The worker fleet | 5 queues: `plan-build`(×2), `analysis-jobs`(×4), `node-run`(×`MAX_CONCURRENT_BRANCHES`), `integration`(×1), `replan`(×2) |
| **Supabase Postgres** | Durable truth | All entities; versioned by `current_revision`; the only thing that survives a reload |
| **Supabase Auth + RLS** | Multi-tenant security | JWT (HS256) with an `org_id` claim; `can_access_plan()` grants by org-membership **or** a `shares`/`delegations` grant, ranked viewer < runner < editor |
| **Supabase Realtime** | Durable change feed | `postgres_changes` → React-Query invalidation → canvas refetch |
| **Supabase Storage** | Delegation specs | Portable subtree-spec JSON in the `specs` bucket; `spec_path` on the `delegations` row |
| **Anthropic — Opus 4.8** | Planner + Analysis | Proposes touch-sets & writes the 5-section grounded cards; *never* decides a dependency |
| **Claude Code runner — Sonnet 4.6** | The builder | Headless `claude -p … --output-format stream-json` in an isolated worktree, fenced by a generated `CLAUDE.md` |
| **Linkup** | External web grounding | On-demand `web_search` tool for Planner/Analysis; results tagged `web:linkup`, never mixed with repo symbols; degrades to off without a key |
| **CopilotKit** | Headless plan-iteration | Runtime `/v1/copilotkit` = `CopilotRuntime` + `AnthropicAdapter` (Sonnet); UI = thin popup with `useCopilotReadable` (plan context) + `useCopilotAction("revise_plan")` → `/replan` |
| **AG-UI** (`@ag-ui/*`) | Agent → canvas transport | The structured event protocol on plane 2; `GuiStream` emits, `useAgentStream` consumes |
| **A2A** (`@a2a-js/sdk`) | Agent-to-agent runner | Optional: dispatch a node's WorkOrder to a remote A2A agent via `A2AClient.fromCardUrl(…)` (Trellis is the *client*; self-exposure is v2) |
| **Python analysis service** | The deterministic core | FastAPI `/index`, `/resolve-touchset`, `/overlap`, `/callgraph-impact`; **tree-sitter** parses real symbols, **networkx** holds the import/call/type graphs |

### The decision the demo is really about (for a technical audience)
*"The Planner proposes; it does **not** decide. When it emits coarse touch-sets, the TypeScript
**dependency engine** asks the Python service to **resolve** each predicted symbol against the real
tree-sitter/networkx graph (fuzzy-matched, with a confidence score) and to **score overlap** between
every pair of nodes. **Shared files or symbols = a hard edge** (overlap 1.0); a shared signature or
schema key is 0.9; config 0.7. Branches are the **weakly-connected components of the hard edges** —
that's the parallelism, computed deterministically. Soft edges only *order* work, they don't block
it. And if the analysis service is ever down, the engine falls back to a conservative Jaccard overlap
on predicted files — it degrades, it doesn't lie."*

### Q&A ammo — one-liner per stack
- **"What's Redis doing?"** — Three jobs: the **BullMQ queue** every worker pulls from, the **two live
  event streams** (canvas + run-log) the API tails over SSE, and the **lock** that serializes
  integration so two merges can't race.
- **"What's Supabase doing?"** — It's the **durable, multi-tenant truth**: Postgres for every entity
  with **RLS** scoping rows to your org, **Realtime** to push changes to the canvas, **Auth** (JWT)
  for identity, **Storage** for delegation specs.
- **"What's CopilotKit?"** — A **headless** plan-iteration layer: a stateless Anthropic-backed chat
  runtime on the API, and a thin popup whose only real power is one human-in-the-loop action —
  `revise_plan` → our `/replan` flow. The canvas, not chat, stays primary.
- **"AG-UI vs Realtime?"** — AG-UI is the **live agent→canvas** stream for an active session; Supabase
  Realtime is the **durable, shared** truth that survives reloads and feeds collaborators. The canvas
  merges both.
- **"How does Claude actually build the code?"** — A **headless Claude Code (Sonnet 4.6)** process runs
  in a **per-node isolated git worktree**, fenced to the node's touch-set by a generated `CLAUDE.md`;
  its stream-json output becomes the live log, and its `git diff` is harvested and **drift-audited**
  against the files we predicted.
- **"Why is parallel safe?"** — Independence is **proven** (disjoint files/symbols in the real graph),
  each branch builds on its **own worktree** (nothing shared to corrupt), and anything uncertain was
  marked **dependent** and runs sequentially. The **integration worker** only merges behind a green
  **test gate**.
- **"What's the analysis service for?"** — The **deterministic brain**: tree-sitter + networkx resolve
  the LLM's guesses to real symbols and compute overlap/blast-radius, so dependency decisions are
  graph facts, not model opinions.

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

🔧 The planner's nodes/edges/branches are now persisted in Postgres; an **analysis job per node** was
just enqueued — that's what populates the sidebar next.

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

🔧 These cards are written by a second **Opus 4.8 analysis agent**, one job per node off the queue,
streamed into the canvas live as each finishes — which is why they fill in progressively.

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

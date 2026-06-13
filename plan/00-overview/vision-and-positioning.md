# Vision & Positioning

> Status: **Canonical.** States the thesis, the wedge, who Trellis is for, and how it is positioned against the linear-plan incumbents — honestly naming where the moat is and where it is not.

## 1. The thesis

> **The agent's output is software, not an answer.**

Every coding assistant on the market today returns one of two things: a chat reply, or a diff. Both are *terminal* — you read them and you're done. Trellis returns a third thing: **a plan you can operate**. When you describe engineering work at any granularity (see the G1–G4 tiers in [`scope.md`](./scope.md)), Trellis's agents produce an **interactive dependency graph of the changes** — a generative, real-time control surface over the work itself. You don't read the output; you *run* it, *iterate* on it, and *delegate* it.

This reframes what the product is. Trellis is **not a UI project** — it is a *dependency-reasoning and parallel-orchestration project with an excellent generative UI on top* (see [`../README.md`](../README.md)). The DAG, the cards, and the buttons are the demo; the product is **correct, trustworthy dependency inference that makes conflict-free parallelism real**. The narrative below explains why that distinction is also the entire competitive argument: the chat is commoditized, and the dependency engine + subtree delegation are not.

## 2. The wedge

The defensible wedge is the intersection of three capabilities that no incumbent ships together:

| # | Capability | What it unlocks | Where it lives |
|---|------------|-----------------|----------------|
| **W1** | **Parallelizable change-DAG** | Decompose intent into nodes, derive edges, and prove which branches are *truly independent* → conflict-free parallel dispatch. | [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md) |
| **W2** | **Grounded analysis** | Per-node assumptions / risks / benefits / notable symbols, each cited to a real symbol or labeled low-confidence — *trust you can audit*. | [`../02-agent-system/analysis-annotation-agent.md`](../02-agent-system/analysis-annotation-agent.md) |
| **W3** | **Subtree delegation** | Export a portion of the plan as a portable, self-contained spec and hand it to another person or agent. *Work becomes portable.* | [`../04-collaboration-delegation/subtree-delegation.md`](../04-collaboration-delegation/subtree-delegation.md) |

**Honest moat statement.** The moat is **W1 + W3** — the dependency engine that makes parallelism safe, and the delegation primitive that makes a subtree portable. The chat interface, the prompt box, and even the pretty graph are *replicable in a quarter* by any well-funded incumbent. What is hard to replicate is a **ratifiable dependency engine whose false-independence rate is near zero on real repos**, plus the orchestration (isolated worktrees, file-overlap locks, integration nodes) that turns that inference into merged code. We compete on *correctness of inference and safety of parallel execution*, not on conversation quality.

## 3. Before / after

| | **Before (linear-plan world)** | **After (Trellis)** |
|---|---|---|
| The artifact | A chat thread or a single PR diff | An interactive, versioned plan graph |
| Decomposition | In the engineer's head; lost after | Explicit nodes + edges, persisted & diffable across revisions |
| Parallelism | Manual, error-prone ("can these two land at once?") | Branches proven independent with cited evidence; one-click parallel dispatch |
| Risk analysis | Skimmed in a review comment, ungrounded | Per-node grounded analysis with symbol citations and a confidence signal |
| Handoff | "Here's a Slack message and a ticket" | A portable subtree spec a person *or* an agent can run and merge back |
| Adapting to size | One template for a typo and a migration | Layout = `f(granularity × change_type × context)` — G1 diff-first … G4 zoomable map |
| When it drifts | Silent; the plan rots | Build discovers a new dependency → edges/branches re-derive; UI shows the drift |

## 4. Who it's for

Full personas and end-to-end scenarios are in [`personas-and-use-cases.md`](./personas-and-use-cases.md). In one line each:

| Audience | Core need Trellis meets | Home tier |
|----------|------------------------|-----------|
| **Staff/senior engineers** decomposing a large change | Turn a refactor in their head into a parallelizable, reviewable plan | G3 Macro |
| **Tech leads** distributing work | Slice a plan into subtrees and hand them to people/agents without merge chaos | G3–G4 |
| **Solo / feature devs** | Plan a feature, run independent pieces in parallel, ship faster | G2 Meso |
| **Agent-fleet operators** | Fan dozens of nodes out to many builder agents with conflict-free dispatch | G4 Mega |
| **External design-partner teams** | A shared, operable plan surface across a small team with safe permissions | G2–G3 |

The two-audience question (internal vs customer-facing) is answered by **phasing, not by building two products** — see Phase A/B/C in [`scope.md`](./scope.md) §6. The dilution risk this creates is tracked in [`risks-and-mitigations.md`](./risks-and-mitigations.md).

## 5. Positioning vs the incumbents

The competitive frame is **linear plan vs operable dependency graph**. Detailed teardown lives in [`../06-appendix/competitive-landscape.md`](../06-appendix/competitive-landscape.md); the honest summary:

| Product | What it does well | The gap Trellis fills |
|---------|-------------------|----------------------|
| **GitHub Copilot Workspace** | Repo-aware spec → linear plan → PR | Plan is **linear & sequential**; no proven-independent branches, no parallel dispatch, no delegation primitive |
| **Devin** | Autonomous end-to-end task execution | Opaque internal plan; you don't get a *ratifiable* DAG to inspect, correct, or fan out by subtree |
| **Cursor agent** | Fast in-editor multi-file edits | Editor-bound; no shared operable plan artifact; no grounded per-node analysis or parallel-merge orchestration |
| **Claude Code** | Strong agentic CLI building & reasoning | Linear session, single worktree; excellent *builder* but no dependency graph, no team delegation surface — **a natural builder backend, not a competitor to the planning layer** |

**The whitespace, said plainly:** every incumbent ships a *linear* plan and then builds. None ships a **ratifiable dependency graph + generated per-context UI + subtree handoff** as a first-class, operable artifact. That triad — originality carried by W1/W3 and the context-adaptive layouts (D11) — is the position. We are deliberately *complementary* to strong builder agents (we can dispatch to them) and *competitive* with the planning/orchestration layer they each bolt on as an afterthought.

## 6. North-star metric

> **North star: parallel-merge-clean throughput** — the count of plan-nodes that are *dispatched in parallel on proven-independent branches and merge cleanly on the first integration attempt*, per active project per week.

This single metric forces the whole product to be honest at once: it only goes up if decomposition is good (P1), if independence inference is correct (the engine), if parallel execution is safe (P3), and if people actually trust the plan enough to run it. A high false-independence rate (corrupted merges) *directly suppresses* the north star, so the metric and the primary safety KPI are aligned rather than in tension. Supporting KPIs, targets, and instrumentation are defined in [`success-metrics.md`](./success-metrics.md).

## To-do list

- [ ] Pressure-test the thesis line ("output is software, not an answer") with 3–5 design partners; capture verbatim reactions.
- [ ] Validate the "moat = engine + delegation, not chat" claim against the latest Copilot Workspace / Devin / Cursor / Claude Code feature sets in [`../06-appendix/competitive-landscape.md`](../06-appendix/competitive-landscape.md).
- [ ] Confirm the north-star metric (parallel-merge-clean throughput) is instrumentable end-to-end and wire it into [`success-metrics.md`](./success-metrics.md).
- [ ] Draft a one-page "before/after" narrative for the demo script (D17) using §3.
- [ ] Decide positioning stance on Claude Code as *builder backend* vs *competitor*; reflect in messaging.
- [ ] Review with the team that no claim here over-promises independence as a guarantee (honesty guardrail, [`scope.md`](./scope.md) §7).

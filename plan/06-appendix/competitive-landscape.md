# Competitive Landscape

> Status: **Canonical.** An honest analysis of where Trellis sits among coding agents and agent orchestrators — what already exists, what's genuinely novel, where the defensible whitespace is, and where incumbents could catch up. Written to keep the team honest, not to flatter the product.

The lane is **crowded and fast-moving**. We win on a *specific combination* — a ratifiable, parallelizable, grounded dependency DAG + generated per-context UI + subtree delegation — not on any single idea in isolation. Several pieces (an editable plan; parallel agents; worktrees) exist in some form elsewhere. Pretending otherwise would make this plan dishonest.

---

## 1. The incumbents (candid read)

### GitHub Copilot Workspace — *the closest comparator*
Microsoft's "task → editable spec → plan → implementation" flow. **This is the closest existing product to Trellis's core idea**, and we should say so plainly: the *editable plan* concept is not ours alone. Copilot Workspace lets you review and edit a proposed plan before code is generated, and it's GitHub-native (issues, PRs, the repo).
- **Where it stops:** the plan is **linear/list-shaped**, not a dependency DAG. There's no notion of *independent branches* derivable for safe parallel execution, no grounded false-independence detection, no per-context generated UI, and no portable subtree handoff. The plan is a checklist you edit, not a graph you operate.

### Devin / Cognition
Autonomous SWE agent: give it a task, it plans and executes end-to-end with its own shell, browser, and editor, largely unattended.
- **Where it stops:** Devin's plan is an *internal, mostly opaque* artifact — the value prop is autonomy, not a shared operable plan-graph. It does not expose a ratifiable dependency DAG, grounded per-node analysis the user adjudicates, context-adaptive UI, or subtree delegation across people/agents. It's "trust the agent to finish," which is the opposite of Trellis's "ratify a grounded plan first" stance (`../00-overview/scope.md` §7).

### Cursor (agent mode / background agents)
IDE-native agent that edits across files, runs commands, and (with background/parallel agents) can dispatch multiple agents.
- **Where it stops:** Cursor is editor-first; its "plan" is a transient to-do, not a durable, versioned, shareable graph artifact. Parallel agents exist but **without a grounded dependency model proving the parallel slices are conflict-free** — parallelism is dispatch, not safety-checked partitioning. No portable subtree spec, no per-granularity generated UI.

### Claude Code (worktrees + subagents)
Anthropic's CLI agent supports git **worktrees** for isolated parallel work and **subagents** for delegating sub-tasks — mechanically the closest to our *execution* substrate (we use worktrees too, `../02-agent-system/parallel-orchestration.md`).
- **Where it stops:** worktrees/subagents are *manual primitives a developer wires up*, not a derived, grounded plan. There's no automatic dependency inference that *tells you which work is independent*, no ratifiable DAG, no false-independence guard, no generated UI, no portable cross-user delegation spec. Claude Code gives you the tools; Trellis gives you the reasoning that decides how to use them safely.

### Parallel-agent orchestrators (Conductor, vibe-kanban-style tools)
A growing class of tools that run several coding agents in parallel over a repo, often on a kanban/board metaphor, each agent on its own branch/worktree.
- **Where it stops:** they orchestrate *parallel dispatch* but **assume or hope the tasks are independent** — there is no grounded engine that *proves* independence from the repo's symbol/call graph and detects false independence. The board is a queue, not a dependency DAG, and there's no portable subtree handoff with an integration contract.

---

## 2. Feature matrix

Honest scoring. ✓ = first-class; ◑ = partial / manual / implicit; ✗ = absent.

| Capability | **Trellis** | Copilot Workspace | Devin | Cursor agent | Claude Code | Parallel orchestrators |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Editable plan before build | ✓ | ✓ | ◑ | ◑ | ◑ | ◑ |
| Plan shape: **dependency DAG** (vs linear list) | ✓ | ✗ (linear) | ✗ | ✗ | ✗ | ◑ (board, not DAG) |
| **Grounded** dependency inference (symbol/call graph) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **False-independence** detection (conflict-free guarantee, ratifiable) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Parallel dispatch of independent work | ✓ | ✗ | ◑ | ◑ | ◑ (manual worktrees) | ✓ |
| Conflict-free *by construction* (proven, not hoped) | ✓ | — | ✗ | ✗ | ◑ (isolation only) | ✗ |
| Grounded per-node analysis (risks/assumptions, cited) | ✓ | ◑ | ◑ | ✗ | ◑ | ✗ |
| **Context-adaptive generated UI** (G1–G4 × change-type) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Subtree delegation** (portable runnable spec, cross-user/agent) | ✓ | ✗ | ✗ | ✗ | ◑ (subagents, in-process) | ◑ (task handoff, not portable spec) |
| Durable, versioned, shareable plan artifact | ✓ | ◑ | ✗ | ✗ | ✗ | ◑ |
| Real-time multi-user co-editing of the plan | ✓ | ◑ | ✗ | ✗ | ✗ | ◑ |

Read it honestly: **the editable-plan column is not unique to us** (Copilot Workspace ties), and **parallel dispatch / worktrees are not unique** (Cursor, Claude Code, orchestrators have forms of it). What no competitor has in one row is the *combination across the whole table* — and three cells are uniquely ours.

---

## 3. The defensible whitespace

Trellis's defensibility is **not** "we have an editable plan" (Copilot Workspace got there) and **not** "we run agents in parallel" (several do). It is the **conjunction** of four things no competitor combines, two of which are individually rare:

1. **A ratifiable, parallelizable dependency DAG** — the plan is a *graph whose independent branches are derived and provable*, not a list. This is the originality core (D4, `../02-agent-system/dependency-inference-engine.md`).
2. **Grounded analysis** — independence claims, edges, and per-node risk analysis are grounded in the real symbol/call graph and cited, with **false-independence detection** as a primary safety metric (FIR). Nobody else grounds parallelism in the repo's actual structure.
3. **Subtree delegation** — exporting a coherent slice as a portable, runnable spec with an integration contract, handed across a trust boundary to a person or agent and merged back. **No competitor has this at all** (`../04-collaboration-delegation/subtree-delegation.md`).
4. **Context-adaptive generative UI** — layouts *and* per-node widgets generated for the specific `granularity × change_type × context`, not templated once (`../03-generative-ui/granularity-layouts.md`).

The moat is the **dependency engine** (the hard, grounded, evaluable part) wearing **generated UI** and made **portable** via delegation. The plan README states it: *the agent's output is software, not an answer* — the operable, grounded, partitionable, delegable plan-graph is the product. Items 2 and 3 are the hardest to copy quickly; item 1 is the conceptual lock; item 4 is the demo surface.

---

## 4. Risks of a crowded lane (no spin)

- **Editable plans are commoditizing.** Copilot Workspace already ships the *concept*; "edit the plan before build" will become table stakes. Our differentiation must live in the **graph + grounding + delegation**, not in "you can edit it."
- **Parallel agents are proliferating fast.** Orchestrators and Cursor/Claude-Code add parallelism monthly. If we sell "parallel agents" we lose; we must sell **provably conflict-free parallelism** (the grounded engine), which is the genuinely hard part.
- **Incumbents own distribution.** GitHub/Microsoft and Cursor own the repo and the editor; we don't. We must be *worth leaving the editor for* (or embeddable into it — phase C, `../00-overview/scope.md` §6).
- **Autonomy hype vs. our ratify-first stance.** The market narrative rewards "fully autonomous." Trellis deliberately keeps a human ratification step (`../00-overview/scope.md` §7). We must frame that as **trust/safety**, not as a limitation — and prove it with FIR and parallel-correctness numbers (`../05-implementation/testing-and-eval.md`).
- **The engine is the whole bet.** If the dependency engine's grounding is weak (high FIR), every differentiator collapses to "another agent with a graph UI." This is acknowledged as make-or-break in `../02-agent-system/dependency-inference-engine.md`.

---

## 5. Where incumbents could catch up (and our answer)

| Incumbent move | How fast | Trellis's durable answer |
|---|---|---|
| **Copilot Workspace** turns its linear plan into a DAG | Plausible medium-term (they have the repo + AST infra) | The DAG is necessary but not sufficient — **grounded false-independence + FIR-evaluated parallel correctness + subtree delegation** is the harder, evaluated part. A DAG that *hopes* branches are independent isn't ours. |
| **Cursor / orchestrators** add a dependency layer to their parallel agents | Plausible; they already run parallel agents | Ours is **grounded in the symbol/call graph with asymmetric caution and ratification**, not heuristic. The eval harness (D15) is the bar; a thrown-together overlap heuristic won't pass it. |
| **Devin** exposes its internal plan as a shareable graph | Possible | Exposing a plan ≠ a *ratifiable, grounded, delegable* plan with per-context generated UI. The whole stack (P1–P4) is the artifact, not just visibility. |
| **Claude Code** automates worktree/subagent wiring from an inferred plan | Possible (they own the primitives) | Closest threat on *execution*. Our edge is the **grounded planning + UI + portable cross-org delegation** layer above the primitives — the reasoning that decides the partition, not just the mechanism that runs it. |
| Anyone copies **subtree delegation** | Hard — needs a grounded DAG first | The portable spec *requires* the dependency engine to exist (you can't cut a clean, contract-bearing subtree from a linear list). Delegation is moated *by* item 1+2. |

**Bottom line:** assume editable plans and parallel agents both commoditize. Bet the company on the part that's hard to copy and easy to evaluate — **the grounded, ratifiable, conflict-free dependency engine** — and on the two things uniquely ours: **subtree delegation** and **per-context generative UI**. Track every "could catch up" item; the open ones live in `open-questions.md`.

---

## To-do list

- [ ] Re-run this comparison each release; competitors ship monthly — keep the matrix honest and dated.
- [ ] Add any new entrant (new orchestrators, IDE agents) to §1 and the matrix.
- [ ] Tie the "defensible whitespace" claims to concrete eval numbers once `../05-implementation/testing-and-eval.md` reports FIR / parallel-correctness / speedup.
- [ ] Validate the "Copilot Workspace is linear, not a DAG" claim against its current shipping behavior before any external use of this doc.
- [ ] Sharpen the phase-C embeddability story (`../00-overview/scope.md` §6) as the answer to incumbent distribution.

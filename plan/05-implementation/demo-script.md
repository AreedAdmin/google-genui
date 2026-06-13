# Demo Script (D17) — end-to-end run-of-show

> Status: **Canonical.** The scripted, reproducible demo that satisfies [deliverable D17](../00-overview/deliverables.md). One flagship storyline (**"Add Sign in with Google + GitHub"**) carries the full spine — plan → grounded analysis → **parallel dispatch of two independent branches** → integration → **subtree delegation** → **real-time re-plan** — and three short vignettes show the **G1/G3/G4** layouts so all four granularities appear. Total runtime ≈ **12–13 min**.

This doc is a presenter run-of-show: each **Act** lists the exact prompt/click, the narration, what it proves (pillar + deliverable), and the fallback if a live agent run is slow. Read alongside [integration-surfaces.md](../01-architecture/integration-surfaces.md) (the `/trellis` launcher) and [agent-runners.md](../02-agent-system/agent-runners.md) (the Claude Code runner).

---

## 0. Pre-flight (before the audience is watching)

**Demo repo:** `acme-app` — a TypeScript **Next.js + Supabase** app with an existing **email/password** login (so OAuth is a believable *addition* to real code, exercising the symbol graph). Lives in a throwaway GitHub org.

**Environment checklist**
- [ ] `acme-app` connected to Trellis; **repo index pre-warmed** (`cache:symbolgraph` hot → planning renders in seconds, not ~30s).
- [ ] **Execution backend = Claude Code (headless)** selected on the project ([agent-runners.md §3](../02-agent-system/agent-runners.md)); credentials configured; a smoke-test node built green earlier today.
- [ ] **Two browser sessions** logged in as **Alice** (presenter/editor) and **Bob** (delegate/runner) for Act 6.
- [ ] Three **pre-built plans** seeded and left in `ready` state for the granularity vignettes (Act 7): `g1-tighten-validation`, `g3-extract-billing`, `g4-analytics-platform`. (Building these live is out of scope for a 12-min demo; they are *real* plans, just pre-generated — see §"What's live vs pre-baked".)
- [ ] Claude Code open in a terminal at the `acme-app` checkout, with the **`/trellis` slash command** installed ([integration-surfaces.md §4](../01-architecture/integration-surfaces.md)).
- [ ] **Fallback recording** of Act 3 (the parallel build) ready to play if the live runners stall.

**What's live vs pre-baked (honesty):** Acts 0–6 run **live** on `acme-app` — real planning, real Claude Code builds, real merge. The only pre-staging is (a) the warm index, (b) the three vignette plans in Act 7, and (c) the Act 3 fallback clip. Nothing is faked; pre-baked items are genuine prior runs.

---

## ACT 1 — Launch from inside the coding agent  ·  ~45s
**Pillar:** entry surface · **Deliverable:** D-surfaces ([integration-surfaces.md](../01-architecture/integration-surfaces.md))

- 🖱 **In Claude Code, type:**
  ```
  /trellis add "Sign in with Google and GitHub" to the login page
  ```
- 🎤 *"I'm in my normal coding agent. I don't ask it to start editing — I ask Trellis to plan it. The slash command kicks off the planner server-side and hands me back a summary and a link."*
- 🖱 Claude Code prints a compact summary:
  ```
  Trellis plan ready · G2 (meso) · 6 nodes · 2 independent branches
  Top risks: OAuth callback race on session creation; secret handling for client secrets
  → https://trellis.app/p/oauth-demo
  ```
- 🖱 Click the link → the **canvas** opens.
- 🎤 *"Notice it didn't try to draw a graph in my terminal — the generative UI lives in the canvas. The terminal is just the launcher."*

---

## ACT 2 — The generative plan (G2 compact DAG)  ·  ~1 min
**Pillar:** P1 (DAG) + P4 (context-adaptive layout) · **Deliverables:** D3, D9, D11

- 🖱 The canvas shows a **left-to-right compact DAG**, 6 nodes, two tinted lanes.
- 🎤 *"Trellis detected this is a meso-sized feature — G2 — so it chose the **compact DAG** layout, the sweet spot. A whole-project request would have rendered a zoomable map instead; a one-line fix would collapse to a diff. The layout is generated for the work."*
- 🖱 Point at the nodes, reading the **change-type colors**:
  - **Branch A (backend & data):** `oauth_accounts` migration → `createSession` logic → `/auth/oauth/:provider` route.
  - **Branch B (frontend & config):** OAuth provider config → "Sign in with…" button.
- 🎤 *"Two lanes, tinted differently because Trellis believes they're **independent** — they touch disjoint files. Hold that thought."*

---

## ACT 3 — Grounded analysis + generated widgets  ·  ~1.5 min
**Pillar:** P2 (grounded analysis) + P4 (per-change widgets) · **Deliverables:** D5, D10, D11-AC2

- 🖱 Click the **migration** node → inspector opens with a **schema-diff widget** on top (before/after `oauth_accounts` columns) and the five sections.
- 🎤 *"Every node carries grounded analysis. **Assumptions** — and see, it cites the real `users` table and `sessions` table from my repo, not a guess. **Analysis** flags a concrete risk: a race between the OAuth callback and session creation. **Benefits.** **Notable variables.**"*
- 🖱 Hover a citation → it links into the actual file/symbol.
- 🖱 Click the **`/auth/oauth/:provider`** node → an **api-contract widget** (method, request, response, the redirect contract, a breaking-change flag).
- 🖱 Click the **`createSession`** node → a **call-graph-impact widget** showing the existing callers of `createSession` that this change touches.
- 🎤 *"Same five sections everywhere, but the node **body** adapts to what the change *is* — a migration shows a schema diff, an endpoint shows a contract, a logic change shows its blast radius. That's generative UI on the second axis."*
- 🖱 Thumbs-down one weak assumption → it greys out.
- 🎤 *"And it's honest — I can reject a claim, and that feedback tunes future analysis."*

---

## ACT 4 — Ratify + parallel dispatch (the headline)  ·  ~2.5 min
**Pillar:** P1 + P3 (parallel execution) · **Deliverables:** D4, D6 · **Criterion:** technical difficulty

- 🖱 Click the edge/handle between the two lanes → an **independence evidence** popover:
  ```
  Branch A ⟂ Branch B  ·  independent
  Disjoint touch-sets — no shared files or symbols.
  A: supabase/migrations/*, src/auth/session.ts, src/auth/oauth.ts
  B: src/config/oauth.ts, src/components/auth/OAuthButtons.tsx
  Shared contract (not a code dependency): POST /auth/oauth/:provider
  ```
- 🎤 *"This is the core of the product. Trellis isn't guessing they're independent — it **proves** it from the symbol graph: the two lanes touch no common file or symbol. The only thing they share is the API **contract**, which is an agreement, not a code dependency. So they can run at the same time."*
- 🖱 Click **Ratify** on the independence claim → both lanes lock as parallel-dispatchable.
- 🖱 Click **Dispatch parallel ⚡**.
- 🖱 Both lanes' nodes flip to `running`; **two live streams** animate side by side — Claude Code editing each worktree, diffs growing in real time.
- 🎤 *"Two Claude Code agents, each in its **own isolated git worktree**, coding both halves of the feature simultaneously. They physically cannot collide — different directories — and Trellis owns the merge. The dependency engine bought us real wall-clock parallelism."*
- ⏱ **Fallback:** if either runner stalls past ~60s, cut to the **pre-recorded Act 3 clip** and narrate over it; resume live at Act 5.

---

## ACT 5 — Integration & merge  ·  ~1 min
**Pillar:** P3 · **Deliverable:** D7

- 🖱 Both branches reach `built`. The **Integration node** activates: merges the two worktrees, wires the button to the real route, runs the **full test gate**.
- 🖱 Tests go green; the node shows a unified diff / **"Open PR"**.
- 🎤 *"The branches reconverge at an integration node. It merges, re-runs the **whole** test suite — a green per-node gate isn't enough — and only then offers the PR. Nothing auto-merges on red."*
- 🖱 Click **Open PR** → a real GitHub PR for `acme-app`.

---

## ACT 6 — Real-time re-plan (iteration)  ·  ~1.5 min
**Pillar:** P4 (real-time) · **Deliverable:** D8

- 🖱 In the **context panel**, type:
  ```
  Also support Apple sign-in, and rate-limit the OAuth callback.
  ```
- 🖱 Submit → the canvas **re-flows live**: a new **Apple provider config** node appears on Branch B; a new **rate-limit** node on Branch A's route; edges re-derive; a **"revision 2"** notice appears (diffable against revision 1).
- 🎤 *"I'm iterating on the plan, not the code. The replan agent produced a new revision; the dependency engine re-derived only the changed parts; the graph animated to its new shape. I can diff revision 2 against 1."*
- 🎤 *(optional)* *"If a build had drifted — touched a file outside its predicted set — you'd see the same live re-flow with a drift notice, and a falsely-parallel branch would demote itself to sequential."*

---

## ACT 7 — Subtree delegation  ·  ~1.5 min
**Pillar:** P3 (delegation) · **Deliverables:** D13, D14 · **Criterion:** originality

- 🖱 As **Alice**: rubber-band select the **Branch B (frontend & config)** subtree → **Delegate subtree**.
- 🖱 A preview of the **portable spec** appears (nodes, edges, frozen analysis, base commit, the integration contract back to the parent). Assign to **Bob**, role **runner**. Send.
- 🎤 *"I can hand a self-contained slice of the plan to a teammate — or another agent. This is the portable spec: everything Bob needs to build the frontend half on his own, with the contract that lets it merge back."*
- 🖱 Switch to **Bob's** browser: a notification; he opens the delegated subtree as a **runnable mini-plan**, clicks **Run**, Claude Code builds it; results merge back into Alice's parent plan via the integration node.
- 🎤 *"That's 'GitHub for plans' — decompose, delegate, reconverge. Nobody else does this."*

---

## ACT 8 — Granularity showcase (G1, G3, G4)  ·  ~2 min
**Pillar:** P4 (the assessment centerpiece) · **Deliverable:** D11-AC1 (distinct layouts per tier)

Rapid-fire, opening the three pre-seeded plans to prove the layout adapts to size:

| ⏱ | Open | Show | Narration beat |
|----|------|------|----------------|
| ~30s | `/trellis "tighten the email validation in login()"` (G1) | **Diff-first** layout — no DAG ceremony, one node, inline diff opens immediately | *"Micro work doesn't get a graph — it gets the diff."* |
| ~45s | `g3-extract-billing` (G3) | **Swimlane** layout grouped by module (db/api/web/infra), explicit integration nodes, and a **⚠ false-independence flag** where web↔api share `checkout.ts` → serialized | *"Macro work gets swimlanes — and watch: it caught two lanes that share a file and refused to parallelize them."* |
| ~45s | `g4-analytics-platform` (G4) | **Zoomable hierarchical map** — clustered super-nodes with counts, assignee avatars per cluster, semantic-zoom **expand** of one cluster into its sub-DAG | *"A whole project becomes a map you navigate and delegate by cluster — then zoom in to the real nodes."* |

---

## Closing — tie back to the four criteria  ·  ~30s

- 🎤 *"To recap what you saw:"*
  - **Originality** — a *ratifiable* parallel dependency graph + subtree delegation; not a linear plan.
  - **Economic value** — two halves of a feature built in parallel, then delegated; the most expensive labor an org has, compressed.
  - **Technical difficulty** — grounded dependency inference proving independence, conflict-free worktree orchestration, live re-plan.
  - **Generative UI** — the layout adapted across four granularities and every node body adapted to its change type, all generated for the work.

---

## Acceptance-criteria coverage (D17)

| D17 requirement | Act |
|-----------------|-----|
| Spans all four granularities | Acts 2 (G2) + 8 (G1/G3/G4) |
| Plan → grounded analysis | Acts 2–3 |
| Parallel dispatch of two independent branches | Act 4 |
| Integration | Act 5 |
| Subtree delegation | Act 7 |
| Real-time re-plan | Act 6 |
| Launched from the coding agent | Act 1 |

---

## Risks & mitigations (live-demo specifics)

| Risk | Mitigation |
|------|------------|
| Live Claude Code build is slow/non-deterministic | Pre-warm index; cap `max_turns`; **pre-recorded Act 4 fallback**; scope nodes small. |
| Planner latency on first render | Warm `cache:symbolgraph` before the session. |
| Merge conflict in Act 5 surprises the flow | The two branches are *proven* disjoint (Act 4 evidence), so the merge is clean by construction; rehearse on the exact base commit. |
| Network/quota mid-demo | Have Bob's delegate run and the vignettes already loaded; degrade to narrated screenshots. |
| Audience asks "is this real?" | Open the GitHub PR (Act 5) and the actual diff; show the worktrees. |

---

## To-do list

- [ ] Build & seed the `acme-app` demo repo (Next.js + Supabase, existing email/password login).
- [ ] Author the OAuth flagship plan and verify it decomposes into the two disjoint branches on the pinned base commit.
- [ ] Pre-generate & freeze the three vignette plans (`g1-tighten-validation`, `g3-extract-billing`, `g4-analytics-platform`) — incl. the G3 false-independence flag fixture.
- [ ] Configure Claude Code runner + credentials; smoke-test a green build on `acme-app`.
- [ ] Install/author the `/trellis` slash command against the demo Trellis instance.
- [ ] Set up Alice/Bob accounts + the delegation grant for Act 7.
- [ ] Record the Act 4 parallel-build fallback clip.
- [ ] Pre-warm the repo index immediately before the session; rehearse end-to-end twice on the pinned commit.
- [ ] Prepare the GitHub PR view + worktree terminal as "proof it's real" tabs.

# Integration Surfaces (how users invoke Trellis)

> Status: **Canonical.** Defines the front doors to Trellis and the decision: **web-app-first, with an MCP server + `/trellis` slash command as the launcher.** One backend (`POST /plans`, [api-design.md](./api-design.md)), several entry points. The generative-UI canvas is home; the plugin starts a plan and deep-links you to it.

This pairs with [agent-runners.md](../02-agent-system/agent-runners.md) (how approved nodes get *coded*) — this doc is about how a plan gets *started* and *operated*.

---

## 1. The principle: launch anywhere, operate in the canvas

The product's value (P4) is the **interactive generative-UI graph** — a DAG with clickable nodes, swimlanes, per-change widgets, and live parallel-run animation. **That cannot render inside a terminal or chat transcript.** So:

> **The web app is the home of the generative UI and the place you review/ratify/operate. Other surfaces are *launchers and monitors*, not replacements.**

This is why the answer to "is it an app or an LLM-tool plugin?" is **both, but the app is primary** — the plugin's job is to let you kick off a plan from inside your coding agent and hand you a link to the canvas.

---

## 2. The surfaces

| Surface | What it is | Role | Phase |
|---------|-----------|------|-------|
| **Web app** (canvas + inspector) | The React Flow generative UI | **Primary** — review, ratify, dispatch, integrate, delegate. | v1 |
| **MCP server + `/trellis <prompt>`** | Trellis exposed as MCP tools; a slash command in Claude Code / any MCP host | **Launcher + monitor.** Start a plan from inside your coding agent; deep-link to the canvas; optionally watch/run headlessly. | v1 |
| **CLI** (`trellis plan "…"`) | Thin wrapper on the API | Scripting / CI. | v1-lite |
| **IDE extension** (VS Code / JetBrains) | In-editor Trellis panel | Richer in-editor entry; embeds a canvas webview. | Phase B |

All four call the same Orchestration API; auth, RLS, and roles are identical regardless of surface ([security-and-auth.md](./security-and-auth.md)).

---

## 3. The Trellis MCP server

Trellis ships an MCP server so any MCP-capable agent (Claude Code first) can drive it. Tools (all auth'd to the caller's Trellis session — §5):

| MCP tool | Does | Maps to |
|----------|------|---------|
| `trellis_plan({ prompt, repo?, granularity? })` | Create a plan from intent; returns `{ plan_id, canvas_url, summary }` | `POST /plans` |
| `trellis_get_plan({ plan_id })` | Fetch the plan (nodes/edges/branches) as compact text | `GET /plans/:id` |
| `trellis_status({ plan_id })` | Current statuses + running nodes | realtime snapshot |
| `trellis_run_node` / `trellis_run_branch` / `trellis_dispatch_parallel` | Execute after approval (role `runner`) | `POST /nodes|branches/:id/run` |
| `trellis_replan({ plan_id, context })` | Iterate the plan | `POST /plans/:id/replan` |
| `trellis_open({ plan_id })` | Return the deep link to the canvas | — |

> **Note — two MCP roles, don't confuse them:** (a) *this* server, where the **coding agent is the client** calling Trellis; and (b) the optional **Trellis-as-context server** that the **Claude Code runner** mounts so it can pull touch-set/analysis during a build ([agent-runners.md §4.1](../02-agent-system/agent-runners.md)). Same protocol, opposite direction.

---

## 4. What `/trellis <prompt>` actually does

The `/trellis` slash command (a Claude Code custom command wrapping the MCP server):

```
You (in Claude Code):  /trellis add OAuth login with Google + GitHub

  1. Command calls trellis_plan({ prompt, repo: <cwd repo>, }) on the Trellis MCP server.
  2. Trellis runs the Planner → Dependency engine → (async) Analysis  [server-side].
  3. Returns to the agent:
       • a COMPACT TEXT summary (tiers, # nodes, # independent branches, top risks)
       • a DEEP LINK:  https://trellis.app/p/<plan_id>
  4. You open the link → the generative-UI canvas with the live DAG.
  5. You ratify + click Dispatch (or stay in-agent and call trellis_run_branch).
  6. Approved nodes are coded by the selected runner (demo: Claude Code) — agent-runners.md.
```

So `/trellis` is exactly the "active inside our coding agents" experience you described: type it, a plan spins up, you get a link to the graph. It does **not** try to draw the DAG in the terminal — it summarizes and links.

---

## 5. Connecting a coding agent to your Trellis account

For the MCP server to act as *you* (RLS-scoped), the coding-agent session must carry a Trellis credential:

- **Device-link / API token:** a one-time `trellis login` (or pasting a personal token into the MCP server config) binds the agent's MCP calls to your Trellis session; every call is then RLS-scoped to your org/role ([security-and-auth.md §1–3](./security-and-auth.md)).
- The token is stored in the agent host's MCP config, never in a repo or prompt.
- All MCP mutations (`trellis_run_*`, `trellis_replan`) re-check role exactly like the REST API; the surface gets no privilege the web app wouldn't.

---

## 6. Headless operation (and its honest limit)

You *can* run a whole loop inside the coding agent: `trellis_plan` → `trellis_get_plan` (read the plan as text) → `trellis_run_branch` → `trellis_status`. Useful for CI or quick single-branch work.

> **The honest caveat:** headless gives up the generative UI — the thing the product is assessed on and the thing that makes ratifying a dependency graph tractable. So Trellis **supports** headless control but **steers** every non-trivial plan to the canvas via the deep link. The demo runs web-app-first for this reason.

---

## 7. Demo flow (v1)

```
Claude Code:  /trellis add OAuth login
      └─▶ summary + link ──▶ open canvas (G2 compact DAG)
            └─▶ inspect nodes (grounded analysis + api-contract widget)
                  └─▶ ratify → "Dispatch parallel" (2 independent branches)
                        └─▶ Claude Code runner codes each branch in its worktree (live stream)
                              └─▶ Integration node merges + tests
                                    └─▶ PR to review
```

---

## To-do list

- [ ] Build the **Trellis MCP server** with the tool catalog (§3); auth via Trellis token; RLS-scoped.
- [ ] Author the **`/trellis` Claude Code slash command** wrapping `trellis_plan` + returning summary + deep link.
- [ ] Deep-link routing in the web app (`/p/:plan_id`) that opens straight to the live canvas.
- [ ] Compact text renderer for plans (`trellis_get_plan` / `trellis_status`) — tiers, branch independence, top risks.
- [ ] `trellis login` / device-link token flow + MCP config storage guidance.
- [ ] Role re-checks on all MCP mutation tools (parity with REST).
- [ ] CLI wrapper (`trellis plan|status|run`) over the same API.
- [ ] (Phase B) IDE extension embedding a canvas webview.
- [ ] Document the two MCP directions (client-of-Trellis vs Trellis-context-server-for-the-runner) to avoid confusion.

# Agent Runners (pluggable execution backends)

> Status: **Canonical.** Defines how an approved `plan_node` is actually *coded*: the **Runner** abstraction. Trellis is an orchestration/planning layer; the real coding is done by a **selectable agentic coding tool** ("runner") that has access to the repo and spins up to fulfil one node's work order inside an isolated worktree. **For v1 / the demo, the runner is Claude Code (headless).** The runner is pluggable so users can choose the agentic model that has access to their code.
>
> **Amended by [mandated-integrations.md](../01-architecture/mandated-integrations.md)** — the Runner boundary is realized as an **A2A** interface: the orchestrator is the A2A client and each runner an A2A remote agent (Claude Code = one A2A runner in v1). Internal orchestration stays on BullMQ. See §3.2.

This is the answer to "once we approve a plan, how do the agents begin coding?" It sits between [parallel-orchestration.md](./parallel-orchestration.md) (which decides *what* to dispatch and *when*) and [integration-merge.md](./integration-merge.md) (which reconverges the results). It generalizes [builder-agent.md](./builder-agent.md), which is now the built-in **native runner** — one implementation of the interface defined here.

---

## 1. The core idea: orchestration owns safety, the runner owns coding

The critical separation that makes runners pluggable **and** safe:

| Concern | Owner | Why |
|---------|-------|-----|
| Worktree creation & **physical isolation** (one per branch off `base_commit`) | **Trellis (orchestration)** | Two branches in two directories physically cannot corrupt each other — independent of which runner is used (ADR-3). |
| **Work order** construction (goal, touch-set, assumptions, risks, acceptance tests, context) | **Trellis** | The runner is *told* the guardrails; it doesn't compute them. |
| **Drift audit** (did edits escape the predicted touch-set?) | **Trellis** | Done by diffing the worktree, not by trusting the runner to report. |
| **Test gate** (per-node + post-merge) | **Trellis** | Trellis runs the tests itself; a runner's self-report is never the gate. |
| **Streaming** logs/diff/tokens to the canvas | **Trellis** (parses runner output) | Uniform UI regardless of runner. |
| **Integration / merge** of branch worktrees | **Trellis** | Runner-independent. |
| **Idempotency** (`run_id`), retries, status machine | **Trellis** | Runner-independent. |
| **Writing the actual code** in the worktree | **Runner** | This is the only thing the runner does. |

> **Why this matters:** external coding agents (Claude Code, Cursor, …) will **not** honor Trellis's internal `lock:file` protocol or touch-set gating mid-write. So we never depend on them to. Safety comes from **physical worktree isolation + a post-hoc diff audit + a Trellis-run test gate** — all enforced at the boundary, around the runner. A runner can only ever *lose parallelism or surface a drift flag*; it can never produce a corrupted merge, because branches never share a working directory and Trellis owns the merge (asymmetric-caution, [dependency-inference-engine.md §4](./dependency-inference-engine.md)).

This is a refinement of the `lock:file` story in [builder-agent.md §5](./builder-agent.md): the **native runner** acquires file locks inside its own tool loop (fine-grained, real-time); **external runners** rely on per-branch worktree isolation + the end-of-run diff audit (coarser, but equally safe for merges). Both honor the same invariant: *no two branches' edits to the same file are ever silently merged.*

---

## 2. The Runner interface

Every runner is an adapter implementing one interface (TypeScript, in `apps/workers`):

```ts
interface AgentRunner {
  id: "native" | "claude_code" | "cursor" | "aider" | string;
  capabilities(): RunnerCapabilities;            // streaming? tool-scoping? max context? cost reporting?
  start(order: WorkOrder, io: RunnerIO): Promise<RunnerResult>;
  cancel(runId: string): Promise<void>;
}

interface RunnerIO {
  onEvent(e: RunnerEvent): void;   // text | tool_call | file_edit | token_usage | error — Trellis relays to stream:run:{id}
}
```

### 2.1 The Work Order (what Trellis hands any runner)
Constructed per node from canon entities ([data-model.md §5](../01-architecture/data-model.md), `node_annotations`):

```jsonc
{
  "run_id": "...", "node_id": "...", "plan_id": "...", "revision": 7,
  "base_commit": "c0...",
  "worktree_path": "/sandbox/<plan>/<branch>",      // pre-created, isolated, sandboxed
  "goal": "Add createSession() and wire it into login",
  "changes": [ /* intended edits from the node */ ],
  "touch_set": {                                    // GUARDRAIL from the dependency engine
    "allowed_files":   ["src/auth/session.ts", "src/auth/index.ts"],
    "allowed_symbols": ["session.ts#createSession", "index.ts#login"],
    "signatures":      ["login(req,res)->Promise<Session>"]
  },
  "assumptions": [ /* from grounded analysis */ ],
  "risks":       [ /* race conditions / failure modes to avoid */ ],
  "acceptance":  { "tests": ["auth/*.spec.ts"], "commands": ["pnpm test"] },
  "context_ref": "cache:symbolgraph:<project>:<commit>",   // cached repo context / symbol summaries
  "policy":      { "network": "deny-except-proxies", "fs_scope": "worktree", "max_turns": 40, "wallclock_s": 900 }
}
```

### 2.2 The Result (what every runner returns)
```jsonc
{
  "run_id": "...", "status": "succeeded | failed | cancelled",
  "files_touched": ["src/auth/session.ts", "src/auth/types.ts"],
  "drift": ["src/auth/types.ts"],          // touched outside touch_set → engine drift hook
  "diff_artifact": "diffs/<run>.patch",     // Trellis harvests via `git diff` in the worktree
  "tokens": 18234, "cost": 0.21,
  "summary": "added createSession; updated login; touched types.ts (unforeseen)"
}
```

Trellis (not the runner) then runs the **test gate**, computes **drift** by diffing the worktree against `touch_set`, persists the diff artifact, and transitions `node_status` — exactly the contracts in [builder-agent.md §2/§7/§8](./builder-agent.md), now applied uniformly to whatever runner produced the edits.

---

## 3. Runner selection ("choose the agent that has access to your code")

- A **project** (or an individual **plan**, overriding the project default) has an `execution_backend` setting: which runner + its config (model, permission mode, max turns).
- The web app shows an **"Execute with ▾"** selector at dispatch time (and in project settings). For v1, the populated option is **Claude Code**; the registry is built so Cursor/Aider/native drop in without schema changes.
- The selected runner is the thing "with access to the code": Trellis hands it the isolated worktree (a real checkout of the repo at `base_commit`) and it operates directly on those files using its own model/credentials.
- Selection is persisted (`projects.execution_backend` / `plans.execution_backend` — additive columns) and recorded on each `runs` row (`runs.agent` already exists in [data-model.md §1](../01-architecture/data-model.md)) for cost/debug attribution.

```
 Project/Plan setting:  execution_backend = { runner: "claude_code", model: "...", permission_mode: "...", max_turns: 40 }
 Dispatch  ─▶  Builder builds WorkOrder  ─▶  Registry.get(execution_backend.runner).start(order, io)
```

---

## 4. The Claude Code runner (v1 / DEMO)

The default and only fully-wired runner for v1. It drives **headless Claude Code** against the node's worktree.

### 4.1 How Trellis spins it up
1. Orchestration creates the isolated worktree at `base_commit` (per [builder-agent.md §3](./builder-agent.md)) — this is the repo checkout Claude Code will edit.
2. Trellis renders the Work Order into:
   - the **prompt** (the `goal` + `changes` + `acceptance`),
   - an injected **`CLAUDE.md`** (or `--append-system-prompt`) in the worktree carrying the **touch-set guardrails, assumptions, and risks** as instructions ("edit only these files/symbols; here are the assumptions and the failure modes to avoid"),
   - a scoped **tool/permission policy**.
3. Trellis launches Claude Code **headless**: `claude -p "<prompt>"` (or the **Agent SDK** `query()`), with:
   - `cwd = worktree_path` (so it has access to exactly this checkout),
   - `--output-format stream-json` for event streaming,
   - scoped `--allowedTools` + a non-interactive `--permission-mode` (auto-accept edits **inside the sandbox**, since Trellis — not the user — adjudicates the final diff),
   - `--max-turns` / model from `execution_backend`,
   - **optionally a Trellis MCP server** (`--mcp-config`) exposing `analysis_lookup`, `touch_set`, and `node_context` tools so Claude Code can pull the grounded blast-radius/symbol context on demand ([prompts-and-tools.md](./prompts-and-tools.md)).
4. Trellis parses Claude Code's `stream-json` events → maps them to `RunnerEvent`s → relays to `stream:run:{run_id}` so the node animates live on the canvas with the **same** streaming UI as any runner ([../03-generative-ui/realtime-ui.md](../03-generative-ui/realtime-ui.md)).
5. On exit, Trellis harvests `git diff` in the worktree → diff artifact; audits touched files vs `touch_set` → `drift[]`; runs the **test gate itself**; transitions `node_status`. Claude Code's reported usage populates `runs.tokens`/`runs.cost`.

### 4.2 Sandboxing & access
- Claude Code runs inside the **same ephemeral sandbox** as any build (gVisor/microVM, deny-all egress except the package + Claude proxies — [../01-architecture/security-and-auth.md §4](../01-architecture/security-and-auth.md)). It sees the worktree and nothing else; no host mounts, no other tenants, no Redis/DB.
- "Access to your code" = access to **this node's worktree only**, never the whole machine or other plans.
- The model credentials are the configured ones (Trellis-managed for the hosted demo; a future BYO-key option lets a customer point at their own Claude Code entitlement).

### 4.3 Why Claude Code is a good demo runner
- It already does the read→edit→test agentic loop well, supports headless + stream-json + MCP + tool/permission scoping, and operates on a working directory — so Trellis gets a capable runner without building the loop, and the **work-order guardrails inject cleanly via `CLAUDE.md` + an MCP context server**.

---

## 5. Other runners

| Runner | Status | Notes |
|--------|--------|-------|
| **Claude Code (headless)** | **v1 / demo** | §4. Default `execution_backend`. |
| **Native** (Sonnet 4.6 loop) | built-in, [builder-agent.md](./builder-agent.md) | Trellis's own tool loop; finest-grained control (in-loop `lock:file`, touch-set path-gating). Good fallback / offline-of-external-agents option. |
| **Cursor / Aider / OpenHands / Devin** | future adapters | Each implements `AgentRunner`; Trellis still owns worktree/drift/test/merge. Brittleness is in output-stream parsing + how each accepts a system-prompt/guardrail. |

Adding a runner = implement `start()` (spawn the tool against the worktree, translate its progress to `RunnerEvent`s) + declare `capabilities()`. Nothing else in the system changes — orchestration, drift, tests, and integration are runner-agnostic by construction (§1).

---

## 6. End-to-end: approve → coding (ties it together)

1. User ratifies the plan on the canvas and clicks **Run** / **Dispatch parallel** (or calls `trellis_run_branch` via the MCP launcher — [../01-architecture/integration-surfaces.md](../01-architecture/integration-surfaces.md)).
2. [parallel-orchestration.md](./parallel-orchestration.md) enqueues `node-run` jobs in topological order; independent ratified branches go concurrently.
3. Per job, the Builder creates the worktree + Work Order, then invokes **`execution_backend`'s runner** (demo: Claude Code) via the registry.
4. The runner codes inside the worktree; Trellis streams progress, then audits drift + runs the test gate.
5. Branch nodes built → **Integration node** merges worktrees, runs the full gate, surfaces conflicts (no auto-merge on red — ADR-1, [integration-merge.md](./integration-merge.md)).
6. Output: a branch/PR to review and merge.

---

## To-do list

- [ ] Define `AgentRunner` / `WorkOrder` / `RunnerResult` / `RunnerEvent` types in `packages/shared` (zod-validated).
- [ ] Implement the **Runner registry** + `execution_backend` resolution (project default → plan override → run record).
- [ ] Add additive `projects.execution_backend` / `plans.execution_backend` columns + `runs.agent` population.
- [ ] **Claude Code runner**: spawn headless (`-p` / Agent SDK `query()`) with `cwd=worktree`, `stream-json`, scoped allowed-tools + permission mode, `max-turns`/model from config.
- [ ] Work-Order → Claude Code rendering: prompt + injected `CLAUDE.md`/`--append-system-prompt` (touch-set/assumptions/risks) + optional Trellis MCP context server (`analysis_lookup`/`touch_set`/`node_context`).
- [ ] Stream-JSON event parser → `RunnerEvent` → `stream:run:{run_id}` relay (uniform with the native runner's stream).
- [ ] Boundary safety: post-run `git diff` harvest, touch-set **drift audit**, Trellis-run **test gate**, idempotency — reuse [builder-agent.md](./builder-agent.md) §2/§7/§8 contracts for all runners.
- [ ] Run Claude Code inside the standard sandbox (deny-all egress + proxies) with worktree-only access ([../01-architecture/security-and-auth.md](../01-architecture/security-and-auth.md)).
- [ ] "Execute with ▾" runner selector in the web app (project settings + dispatch) — Claude Code populated for v1.
- [ ] Keep the **native runner** ([builder-agent.md](./builder-agent.md)) behind the same interface as a fallback.
- [ ] Adapter-author guide (what `start()`/`capabilities()` must do) for future runners (Cursor/Aider).
- [ ] (Future) BYO-key / customer-entitlement path for the selected runner.

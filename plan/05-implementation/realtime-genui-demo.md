# Realtime generative-UI demo script

> A copy-paste runbook for showing the generative UI change **live**: create a plan,
> add context, and watch the canvas re-flow (layout reshape + new per-node widgets) in
> real time. Pairs the two model-driven axes (granularity→canvas, change_type→widget)
> with the replan worker + annotation polling.

## What makes it "real-time"
1. **Initial fill-in** — `plan-build` inserts nodes (canvas renders), then the `analysis`
   worker writes the 5 inspector sections + widgets a few seconds later; the canvas pulls
   them in without a refresh (the `usePlanGraph` annotation poll).
2. **Re-flow on context** — *Add context* (or the Plan copilot popup) →
   `POST /v1/plans/:id/replan` → the **replan worker** writes a new revision → the canvas
   re-derives and re-renders to the new shape.

## How to run any pair
1. Home (`localhost:3000`) → paste the **Step 1** prompt → the canvas builds; watch nodes
   appear, then the sections/widgets populate.
2. Toolbar → **Add context** → paste the **Step 2** text → **Re-plan** → the canvas
   re-flows in place to the new revision. *(Or open the **Plan copilot** popup, bottom-right,
   and type the Step-2 text conversationally — it calls the same replan.)*
3. If the re-flow doesn't appear within ~10s, hard-refresh once.

---

## Primary demo — against this repo (`google-genui` / Trellis monorepo)

> First connect it: home → **Connect repo** → `https://github.com/AreedAdmin/google-genui.git`.
> Plan-build clones + indexes it, so touch-sets resolve to real files
> (`services/runs.ts`, `workers/node-run.ts`, the Claude Code runner's `cancel()`).

**Step 1 — plan prompt:**
```
Add run cancellation to Trellis: a POST /v1/runs/:id/cancel endpoint that marks the
run cancelled and signals the node-run worker to stop the in-flight build.
```
*Expect:* a focused **G2 plan, ~3–4 nodes, compact DAG** — an API route node (`api_contract`
widget), a runs-service node, a worker node (`call_graph_impact` widget).

**Step 2 — context message:**
```
Expand this into a complete cancellation feature, structured as independent parallel
workstreams so separate engineers can build them at once:
(1) a DB migration adding a cancelled_at column to runs plus a Redis cancel flag;
(2) the /v1/runs/:id/cancel API route + runs service;
(3) the node-run worker watching the flag and aborting the Claude Code runner;
(4) a Stop button and a "cancelling" state in the web canvas inspector;
(5) integration tests for the cancel path.
Keep the lanes independent so they can run in parallel.
```
*Watch change in real time:*
- Canvas **re-flows compact DAG → `swimlane_dag`** — lanes by **db / api / workers / web /
  test**, tinted, toolbar CTA → **"dispatch parallel."** (model-driven layout, Change 1)
- **New widgets appear** on the new nodes: `schema_diff` (migration), `key_diff` (Redis flag),
  `component_preview` (Stop button), `checklist`/`test_linkage` (tests). (Change 2)
- An **integration node** + possibly a **⚠ false-independence flag** if two lanes share a file
  (e.g. `runs.ts`).

---

## Backup pairs — against the seed Demo Project (`yocto-queue`)

Proven against the connected seed repo (a small FIFO `Queue` class); good if you don't want to
connect a new repo.

### A — canvas reshape (compact_dag → swimlane_dag)
**Step 1:**
```
Add a peek() method to the Queue that returns the next item without removing it.
```
**Step 2:**
```
Expand this: add three more capabilities that different engineers can build in parallel
without conflicts — a toArray() method, an async-iterator drain(), and a bounded-capacity
option that rejects enqueue when full. Add tests for each.
```
*Watch:* small list/DAG → **swimlane_dag** with parallel lanes; parallelism CTA appears.

### B — new widget types appear
**Step 1:**
```
Refactor the Queue to use a singly linked list internally so dequeue is O(1) instead of array shift.
```
**Step 2:**
```
Also add durable snapshots: a JSON snapshot file format, a SNAPSHOT_PATH config option,
save/restore methods, and a short docs note on the format.
```
*Watch:* `call_graph_impact` → plus `key_diff` (config), `checklist`/`test_linkage` (tests),
`markdown` (docs) as the new nodes land.

---

## Demo tips
- Keep **Step 1 small** so the Step-2 change is dramatic.
- Use **"independent / parallel"** wording in Step 2 to reliably trigger the `swimlane_dag`
  reshape (the planner emits a parallel layout, which the model-driven canvas honors).
- The **Plan copilot** popup (CopilotKit, `apps/web/components/canvas/PlanCopilot.tsx`) runs the
  same `revise_plan` → replan, so you can demo the context step conversationally.

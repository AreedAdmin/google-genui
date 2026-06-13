# @trellis/web — the generative-UI web app

The assessed surface of Trellis: a Next.js (App Router) app that turns a prompt
into a **grounded dependency graph you operate**, with an interface that is
**generated per plan from a validated spec** — never raw model HTML.

> The agent does not write the UI. The agent writes a *spec* for the UI
> (`LayoutSpec` + `WidgetSpec[]`), and a trusted registry renders it.
> Granularity picks the canvas; change-type picks each node's widgets.

## Run

```bash
pnpm install            # from the repo root (workspace)
pnpm --filter @trellis/web dev   # http://localhost:3000
```

Env (`.env.local`, all optional for the demo — fixtures back the UI when unset):

```
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

The app degrades gracefully: with no API/Supabase it serves four demo plans
(one per granularity tier) so every layout and widget renders end-to-end.

## Routes

- `/` — project + recent-plans list and the prominent **"Describe what to
  build"** prompt box. Submitting `POST`s `/v1/plans` and routes to `/p/[id]`.
- `/p/[id]` — the **canvas**: `GET /v1/plans/:id` (a `PlanGraph`) via
  react-query, rendered with React Flow; Supabase Realtime on `plan_nodes` +
  `runs` keeps it live; the inspector's **Add context** calls `/replan`.

## The two generative-UI axes

**Axis A — granularity → canvas** (`LayoutSpec.canvas`). The layout engine
(`lib/layout.ts`) is a pure `(graph, canvas) → positioned nodes` strategy:

| canvas | tier | strategy |
|--------|------|----------|
| `checklist` | G1 micro | single diff-first column |
| `compact_dag` | G2 meso | dagre LR/TB |
| `swimlane_dag` | G3 macro | lanes grouped by module, dagre per lane |
| `hierarchical_map` | G4 mega | clustered super-nodes + minimap, semantic zoom |

Nodes are colored/iconed by `change_type` + `node_status`; edges styled by
`edge_type` with **evidence on hover**; independent branches tinted, with inline
**⚠ false-independence** when "independent" lanes share a file.

**Axis B — change_type + context → node body** (`WidgetSpec[]`). The trusted
registry (`components/widgets/registry.tsx`) validates each spec against
`@trellis/shared` `WidgetSpec` (zod), narrows props per-widget, and renders from
a closed set — **no `dangerouslySetInnerHTML` / eval anywhere**. Invalid/unknown
⇒ `FallbackWidget` (the spec's `fallback_text`). The four MVP widgets:

- `schema_diff` — before/after table + migration ordering
- `api_contract` — endpoint + request/response tables + breaking-change flags
- `component_preview` — skeleton preview + prop table + named states
- `call_graph_impact` — root symbol + affected callers/callees + blast radius

(`key_diff` is included so config nodes render richly.)

## Node inspector (`components/inspector/`)

A right-hand drawer with the five `NodeAnnotation` sections — **Changes ·
Assumptions · Analysis** (risks w/ severity) **· Benefits · Notable** — each with
citation chips, confidence meters, low-confidence labels, and per-claim 👍/👎
(`POST /v1/feedback`). The default tab comes from
`LayoutSpec.default_inspector_tab`. Action bar: **Run · Share · Delegate
subtree · Add context**, wired to `/run` (+ live SSE `/runs/:id/stream`),
`/shares`, `/delegate`, `/replan`.

## Structure

```
app/                 layout.tsx · page.tsx (home) · p/[id]/page.tsx (canvas) · not-found.tsx
components/canvas/   GraphCanvas · PlanNodeView · PlanEdgeView · CanvasToolbar · SelectionBanner · CanvasPage
components/inspector/ NodeInspector · Sections · ActionDialogs · RunLog
components/widgets/   registry.tsx + WidgetFrame + the 4 MVP widgets (+ KeyDiff)
components/ui/        primitives · overlay (Dialog/Sheet) · trust (Grounding/Citation/Feedback)
components/home/      PromptBox · PlanList
lib/                  api.ts · supabase.ts · store.ts (Zustand) · dagre.ts · layout.ts · design.ts · hooks.ts · utils.ts · fixtures.ts
```

Design system: Tailwind + semantic CSS-variable tokens (light/dark), a
per-`change_type`/`status` node language, lucide icons. Color is never the only
signal — every status/severity/confidence pairs hue with an icon and a label.

# Deepening the Generative UI — model-driven layout + richer widgets

> Status: **Change 1, 2 & 3 built.** This doc records a set of changes that make
> Trellis's generative UI *more genuinely generative* without weakening the safety model
> (validated specs, closed component set, no raw model HTML). It amends
> [genui-philosophy.md](./genui-philosophy.md), [granularity-layouts.md](./granularity-layouts.md),
> and [widget-generation.md](./widget-generation.md), and is the source referenced from
> `context.mmd` §4/§19/§20.

## Motivation

Trellis's generative UI has **two model-driven axes**: **Axis A** — granularity → canvas layout
(planner emits `LayoutSpec`); **Axis B** — change_type → node-body widget (analysis agent emits
`WidgetSpec[]`). An honest audit of the as-built code surfaced three gaps that made the UI feel
templated rather than generative:

1. **Axis A wasn't actually model-driven.** `agents/planner.ts` ran `reconcileTier()` and then
   *overwrote* `layout_spec.canvas` with `canvasForTier(nodeCount)` — so the rendered canvas was
   `f(node count)`, not the model's choice. The doc claimed "tier is a default, not a cage"; the
   code contradicted it.
2. **Four change types always fell back.** The `WidgetKind` enum and the analysis agent's
   `WIDGET_FOR_CHANGE_TYPE` mapped `bugfix→test_linkage`, `infra→resource_diagram`,
   `test→checklist`, `docs→markdown`, but the **client registry only registered 5 widgets** — so
   those node types rendered the `FallbackWidget` every time.
3. **Nodes were single-widget.** The contract allowed `widget_specs: WidgetSpec[]`, but the agent
   prompt said "emit at least one," so nodes nearly always carried exactly one widget.

## Invariants preserved (unchanged by all changes)

- **No raw model HTML / `eval` / `dangerouslySetInnerHTML`** — render from validated specs only.
- **Never throws → always degrades** to `FallbackWidget` / fallback text.
- **Props byte-capped** per widget (anti-DoS).
- **Grounding is structural** — every widget renders through `WidgetFrame` (always a `GroundingChip`).

---

## Change 1 — Model-driven layout (unclamp the canvas) · **BUILT**

**File:** `apps/workers/src/agents/planner.ts`.

- Removed `data.layout_spec.canvas = canvasForTier(reconciled)` (and deleted the now-unused
  `canvasForTier`). The planner's emitted `canvas`, `grouping`, `direction`, `emphasis`,
  `parallelism_ui` now survive to the DB and the canvas.
- `reconcileTier()` still runs, but only adjusts the **tier label** (`detected_granularity` /
  `layout_spec.tier`), which legitimately drives analysis depth + cost budgets.
- Added a **coherence guard** `coherentCanvas(canvas, nodeCount)` so model freedom can't render
  incoherently:
  - `checklist` → `compact_dag` when `> 3` nodes (a long checklist hides the DAG);
  - `hierarchical_map` → `swimlane_dag` when `< 15` nodes (below macro it renders every flat node
    as an oversized super-node);
  - `compact_dag` / `swimlane_dag` pass through at any count. Corrections are logged.
- Rewrote the planner SYSTEM-prompt rule that hard-coupled tier→canvas: the tier is now stated as
  a **prior**, and the planner is told to pick the canvas that fits the work's actual shape.

**Data path:** `plan-build.ts` persists `emitted.layout_spec` verbatim into `plans.layout_spec`;
`computeLayout()` / `GraphCanvas` read `layout_spec.canvas` directly. No second clamp exists.

---

## Change 2 — Richer, multi-widget node bodies · **BUILT**

**Closes the fallback gap (all 10 change types now render a real widget) and lets a node carry
1–3 grounded widgets.**

### New client widgets (`apps/web/components/widgets/`)
Each follows the `SchemaDiff` pattern — an exported `XProps` zod schema + an `X` component wrapping
`WidgetFrame`:

| Widget | change_type | Renders |
|--------|-------------|---------|
| `test_linkage` (`TestLinkage.tsx`) | bugfix/test | test↔symbol coverage map + uncovered-symbol flags |
| `resource_diagram` (`ResourceDiagram.tsx`) | infra | declarative resource boxes (add/modify/remove) + relation list |
| `markdown` (`Markdown.tsx`) | docs | **safe** markdown subset (headings/lists/inline-code/bold/fences) via a line-based parser → React elements; **no `dangerouslySetInnerHTML`** |
| `checklist` (`Checklist.tsx`) | test | ordered steps with per-item state (done/active/todo/blocked) + completion count |

All four are registered in `registry.tsx` (`test_linkage` 32KB, `resource_diagram` 64KB,
`markdown` 32KB, `checklist` 32KB), bringing the registry to **9 widgets**.

### Analysis agent (`apps/workers/src/agents/analysis.ts`)
- SYSTEM rule changed from "emit at least one" to **emit the primary widget + any supported
  secondary (compose 1–3 total)**, with concrete examples.
- Added `WIDGET_PROPS_HINT` — a compact per-widget props shape fed into the user prompt (the
  primary widget + the universally-applicable `checklist`/`markdown`). Shape drift is the #1 cause
  of fallback renders; the hints keep emitted props inside the client zod schemas. **These hints
  must stay in lockstep with the client widget schemas.**
- The zero-widget safety injector is unchanged (still guarantees ≥1 widget).

### Fixtures (`apps/web/lib/fixtures.ts`)
The G3 plan gains annotations exercising every new widget, including two **multi-widget** nodes:
`g3n5`→`resource_diagram`; `g3n6`→`checklist` + `test_linkage`; `g3n7`→`call_graph_impact` +
`markdown`. This proves the render path with no backend (the fixture-fallback path).

---

## Change 3 — Composable primitive widget layer · **BUILT**

The deepest step: the node body moves from *selected* (pick one of N widgets) to *composed*
(assemble from primitives).

- **Contract** (`packages/shared/src/genui.ts`): added `composed` to `WidgetKind` (now 10 kinds).
- **Client** (`apps/web/components/widgets/Composed.tsx`): the closed primitive vocabulary —
  `stat | table | tree | diff_row | timeline | text` — as a zod `discriminatedUnion`
  (`PrimitiveBlock`), one renderer each, plus the `Composed` widget. The registry-level
  `ComposedProps` is **lenient** (`blocks: unknown[]`) so each block is validated *independently*
  via `safeParse`: a malformed/unknown block is **skipped** (with an inline notice), not fatal —
  the widget still never throws and never renders raw HTML. Registered at 256KB (it aggregates).
- **Analysis agent** (`apps/workers/src/agents/analysis.ts`): `composed` added to the widget enum,
  the props-shape hint, and the offered set; SYSTEM rule tells the agent to prefer a named widget
  and reach for `composed` only when none fits.
- **Fixtures**: the G3 `Update checkout UI` node carries a `composed` widget exercising **all six**
  primitives (stat ×2, text, diff_row, table, tree, timeline).

Tree is modelled as a **flat list with `depth`** (not recursive) — simpler for the model to emit
and robust to render. The vocabulary stays closed, so this adds composition *without* an injection
surface — the opposite of "let the model write React."

---

## As-built status

| Item | Status |
|------|:------:|
| Change 1 — model-driven canvas + coherence guard | ✅ built |
| Change 2 — 4 new widgets registered (10/10 change types covered) | ✅ built |
| Change 2 — multi-widget composition (1–3 per node) | ✅ built (agent prompt + fixtures) |
| Change 3 — composable primitive layer (`composed`) | ✅ built (10th widget; 6 primitives) |

## Verification

- `pnpm --filter @trellis/workers typecheck` — clean.
- `pnpm --filter @trellis/web typecheck` — clean.
- Render path proven via fixtures (all four new widgets + two multi-widget nodes in the G3 demo).
- **Not runtime-verified end-to-end:** observing a live planner emit a non-default canvas, or a
  live analysis call compose multiple widgets, needs the running stack (Anthropic key + Redis +
  Supabase). The DB→render path and the contracts are verified; the live LLM hop is not.

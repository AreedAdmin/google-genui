# Context-Adaptive Generative Layouts (assessment centerpiece)

> Status: **Canonical.** This is the document the project is most assessed on (generative UI). It specifies how Trellis renders **different layouts for different granularities and change-types** — i.e. `Layout = f(granularity × change_type × context)` — and how those layouts are *generated and validated* rather than hand-coded one-by-one.

## 1. Principle

Generative UI here is **not** "the model emits arbitrary HTML." It is: **the agents emit a validated `LayoutSpec` + per-node `WidgetSpec`s, chosen for the specific work, which the client renders from a trusted component registry.** This gives the *adaptivity* of generative UI with the *safety and consistency* of a design system. (Philosophy detail: `genui-philosophy.md`; widget detail: `widget-generation.md`.)

Two axes of adaptation:
1. **Granularity (size)** → the *canvas* layout (how the whole plan is presented).
2. **Change-type + context** → the *node* content (which widgets render inside a node).

Both are produced by the planning/analysis agents as part of the plan and validated before render.

## 2. The four granularity layouts

### G1 — Micro (1–3 nodes): **Diff-First**
- **Canvas:** the DAG collapses to a **single column / checklist**; no graph ceremony. If 1 node, the canvas *is* the inspector.
- **Emphasis:** the code **diff** and the one or two real risks. Inspector opens directly to **Changes**; Assumptions/Analysis are compact.
- **Parallelism:** hidden (not meaningful).
- **Delegation:** "Share diff" only.
- **Wireframe**
```
┌───────────────────────────────────────────────┐
│  Micro plan · "tighten login validation"       │
├───────────────────────────────────────────────┤
│  ● Validate email before hashing      [Run ▸]  │
│     ┌─────────────────────────────────────────┐│
│     │  - if (!user) ...                        ││  ← inline diff is primary
│     │  + if (!user || !isEmail(user.email))    ││
│     └─────────────────────────────────────────┘│
│     Assumptions (2) · Risks (1) · Benefits (1)  │  ← collapsed chips
└───────────────────────────────────────────────┘
```

### G2 — Meso (4–15 nodes): **Compact DAG** *(the sweet spot)*
- **Canvas:** left-to-right DAG (dagre), a handful of nodes; independent branches visually separated.
- **Emphasis:** **contracts** (API/types) and the **test plan**; node inspector defaults to the change-type widget (e.g. api-contract table).
- **Parallelism:** 1–3 branches; "Run branch" buttons visible; independent branches tinted.
- **Delegation:** "Delegate subtree" available per branch.
- **Wireframe**
```
┌──────────────────────────────────────────────────────────────┐
│ Meso · "Add OAuth login"            [Run all ▸] [Add context] │
├──────────────────────────────────────────────────────────────┤
│  [DB: oauth_accounts]──▶[API: /auth/oauth]──▶[UI: login btn]  │
│         (migration)         (api_contract)      (ui_component) │
│                    └──▶[config: providers]  ← independent ▍    │
│   ▍ branch A ─ run ▸     ▍ branch B (independent) ─ run ▸      │
└──────────────────────────────────────────────────────────────┘
```

### G3 — Macro (15–50 nodes): **Swimlane DAG**
- **Canvas:** **swimlanes grouped by component/module** (e.g. `api`, `web`, `db`, `infra`); edges cross lanes; **Integration nodes** explicit at reconvergence points.
- **Emphasis:** **parallelism + conflict guard**; the canvas highlights which lanes are independent and which share files (false-independence flags shown inline).
- **Parallelism:** many branches; a **"Dispatch parallel"** affordance selects all proven-independent branches.
- **Delegation:** lane- or subtree-level handoff; assignee avatars on lanes.
- **Wireframe**
```
┌───────────────────────────────────────────────────────────────────────┐
│ Macro · "Extract billing into a service"   [Dispatch parallel ⚡] ...   │
├──────────┬────────────────────────────────────────────────────────────┤
│ db       │  [migrate ledger]──────────────┐                            │
│ api      │  [billing client]──[wire routes]┼──▶◆ Integration ─▶[remove │
│ web      │  [update checkout]──────────────┘     (merge+tests)  legacy]│
│ infra    │  [new svc deploy] ▍independent                              │
│          │  ⚠ web↔api share `checkout.ts` → serialized                 │
└──────────┴────────────────────────────────────────────────────────────┘
```

### G4 — Mega (50+ nodes): **Zoomable Hierarchical Map**
- **Canvas:** **clustered super-nodes** (one per subsystem/milestone) with a **minimap**; click a super-node to **expand** into its sub-DAG (G3/G2 view). Milestone lanes across the top.
- **Emphasis:** **navigation + delegation**; the map view is for planning who-does-what, not reading diffs.
- **Parallelism + delegation:** primary actions — assign whole clusters/milestones to users or agent fleets; semantic zoom hides detail until you descend.
- **Wireframe**
```
┌──────────────────────────────────────────────────────────────┐
│ Mega · "Build analytics platform"   [minimap�]   M1 M2 M3 M4   │
├──────────────────────────────────────────────────────────────┤
│  ╔═══════════╗   ╔═══════════╗   ╔═══════════╗                 │
│  ║ Ingestion ║──▶║ Storage   ║──▶║ Query API ║   ╔══════════╗  │
│  ║ (12 nodes)║   ║ (9 nodes) ║   ║ (15 nodes)║──▶║ Dashboard║  │
│  ╚═══════════╝   ╚═══════════╝   ╚═══════════╝   ║ (18)     ║  │
│   @alice          @bob (agent)    unassigned     ╚══════════╝  │
│   click to expand ▾                                            │
└──────────────────────────────────────────────────────────────┘
```

## 3. Granularity layout spec (machine form)

The planner attaches a `LayoutSpec` to the plan; the client renders accordingly.

```jsonc
// LayoutSpec
{
  "tier": "g2_meso",
  "canvas": "compact_dag",            // checklist | compact_dag | swimlane_dag | hierarchical_map
  "direction": "LR",                  // LR | TB
  "grouping": null,                   // null | "by_module" | "by_milestone"
  "emphasis": ["contracts", "tests"], // drives default inspector tab + node badges
  "parallelism_ui": "branch_buttons", // hidden | branch_buttons | dispatch_parallel | assign_clusters
  "delegation_ui": "per_branch",      // share_diff | per_branch | per_lane | assign_clusters
  "semantic_zoom": false,             // true for g4 super-node expansion
  "default_inspector_tab": "changes"  // changes | contract | assumptions | analysis
}
```

The tier is auto-detected (request shape + touch-set breadth + node count) but **user-overridable**; promoting/demoting a plan re-emits a `LayoutSpec` and re-flows the canvas.

## 4. Change-type → node widget mapping (the second axis)

A node's *inner content* adapts to its `change_type` and the context the analysis agent extracted. The node inspector renders the matching **WidgetSpec** (validated; see `widget-generation.md`).

| `change_type` | Primary widget | Shows |
|---------------|----------------|-------|
| `migration` | **schema-diff** | before/after table or column structure; ordering vs other migrations |
| `api_contract` | **api-contract table** | endpoint, request/response shapes, status codes, breaking-change flags |
| `ui_component` | **component-preview** | rendered/skeleton preview + prop table + states |
| `logic` / `refactor` | **call-graph-impact** | the symbol, its callers, and the blast radius from the engine |
| `bugfix` | **test-linkage** | the failing test/repro → the fix → expected pass |
| `config` | **key-diff** | config/env/DI keys added/changed and their consumers |
| `infra` | **resource-diagram** | resources created/changed (containers, queues, buckets) |
| `test` / `docs` | **checklist/markdown** | lightweight |

> The **same node** therefore looks different depending on what it *is* — a migration node and a UI node in the same plan render different bodies. This is the "different layouts for different contexts" the product is judged on, expressed at node granularity.

## 5. How layouts are *generated* (the genUI mechanism)

1. **Planner** detects granularity → emits `LayoutSpec` (validated against the canvas enum).
2. **Analysis agent** per node emits `WidgetSpec[]` keyed by `change_type`, populated with grounded data (real symbols, real schema, real contract).
3. **Validation gate:** every `LayoutSpec`/`WidgetSpec` is checked against the **component registry** (zod). Unknown widget or invalid props → fall back to a safe default widget; never render raw model output.
4. **Layout engine (client):** maps `canvas` → a React Flow layout strategy (dagre LR/TB, swimlane, hierarchical-cluster) and `default_inspector_tab`/`emphasis` → inspector defaults and node badges.
5. **Re-flow on change:** tier change, re-plan, or drift re-emits specs; the canvas animates to the new layout (`realtime-ui.md`).

This is the crucial nuance for assessment: **the UI is composed by the agents per-plan and per-node from validated specs** — adaptive and generated, yet production-safe.

## 6. Responsive & accessibility behavior

- **Semantic zoom (G4):** at low zoom show clusters + counts; descending reveals sub-DAG; minimap always available.
- **Density controls:** user can collapse analysis chips, hide soft edges, or focus a branch.
- **Keyboard/a11y:** nodes focusable; inspector sections are tabbable; widgets carry ARIA roles; color is never the only signal (status uses icon+label, not just hue).
- **Small screens:** canvas degrades to a vertical list (≈ the G1 layout) with the graph available behind a toggle.

## 7. Edge cases

- **Mixed-granularity plan:** a G3 plan may contain a G1-ish trivial node — it still renders its change-type widget; the canvas tier governs the *frame*, the node governs its *body*.
- **Tier mis-detection:** user override is one click; the engine logs the correction to improve detection.
- **Unknown change-type:** falls back to `logic`/markdown widget; flagged for the registry backlog.
- **Empty/over-large plans:** G1 with 0 real changes shows a "no changes needed — here's why" panel; G4 over a node cap auto-clusters.

---

## To-do list

### Layout engine
- [ ] `LayoutSpec` schema + zod validator + safe fallback.
- [ ] React Flow layout strategies: `checklist`, `compact_dag` (dagre LR/TB), `swimlane_dag`, `hierarchical_map`.
- [ ] Tier auto-detection (request + touch-set breadth + node count) with user override + correction logging.
- [ ] Swimlane grouping by module; integration-node rendering.
- [ ] Semantic zoom + super-node expand/collapse + minimap (G4).
- [ ] Re-flow animation on tier change / re-plan / drift.

### Node widgets (the second axis)
- [ ] `WidgetSpec` schema + component registry + zod validation + fallback.
- [ ] schema-diff, api-contract, component-preview, call-graph-impact (the 4 MVP widgets — see `widget-generation.md`).
- [ ] key-diff, test-linkage, resource-diagram (phase 2).
- [ ] Default-inspector-tab + emphasis badges wired from `LayoutSpec`.

### Cross-cutting
- [ ] Density controls (collapse chips, hide soft edges, focus branch).
- [ ] A11y pass (focus order, ARIA, non-color status, keyboard nav).
- [ ] Responsive degrade-to-list.
- [ ] Visual regression tests for each tier × representative change-types.
- [ ] Demo fixtures: one plan per tier (G1–G4) for `D17` demo.

# Graph Canvas (the React Flow DAG surface)

> Status: **Canonical.** Specifies the React Flow canvas that renders a plan as an interactive dependency DAG — axis A (granularity → canvas) of the [generative-UI philosophy](./genui-philosophy.md) made concrete — including custom node/edge renderers, branch visualization, the operate/ratify interactions, layout-strategy switching from `LayoutSpec`, state, realtime, and large-graph performance.

This is **D9** (`deliverables.md`). It consumes the validated `LayoutSpec` from [`granularity-layouts.md`](./granularity-layouts.md) §3 and renders it from the trusted registry — it never interprets raw model output. Read [`genui-philosophy.md`](./genui-philosophy.md) §5 for the principles this doc instantiates.

## 1. Responsibilities

The canvas is the **whole-plan frame**. It is responsible for:

1. Rendering `plan_nodes` as **custom nodes** colored/iconed by `change_type` and `node_status`, badged by `LayoutSpec.emphasis`.
2. Rendering `plan_edges` as **typed edges** (`depends_on` / `data_flow` / `sequence` / `soft_order`) with distinct styling and **evidence on hover**.
3. Making **independent `branches` visually distinct** and flagging **false independence** inline with **⚠**.
4. Hosting the **operate** affordances — Run node/branch, Dispatch parallel, Delegate subtree — and the **ratify** affordances (ratify / add / split edge) wired to the dependency engine.
5. **Switching layout strategy** off `LayoutSpec.canvas` (checklist / compact_dag / swimlane_dag / hierarchical_map), with **semantic zoom + minimap** for G4.
6. Staying **live** (realtime updates) and **responsive** (optimistic local edits), and **performant** on large graphs (virtualization, super-node collapse).

The body *inside* a node is axis B and belongs to [`node-inspector.md`](./node-inspector.md) / [`widget-generation.md`](./widget-generation.md); the canvas renders a **compact node face**, not the full widget.

## 2. Custom node renderers (per `change_type` + `node_status`)

One React Flow `nodeType` per registry entry. The node **face** is a small, dense card whose appearance is a pure function of `change_type`, `node_status`, `confidence`, and `LayoutSpec.emphasis`.

```
        compact node face (G2/G3)
 ┌────────────────────────────────────┐
 │ ◷ api_contract        ⚠  ●●●○ 0.74 │  ← icon+label (change_type) · false-indep ⚠ · confidence dots
 │ POST /auth/oauth                    │  ← title
 │ [contract] [tests]      ▶ Run  ⋯    │  ← emphasis badges (from LayoutSpec) · quick actions
 │ branch A · running ▓▓▓▓▓▓░░ 60%     │  ← branch tint bar + status + live progress
 └────────────────────────────────────┘
   ▲ left handle (targets)     right handle (sources) ▲
```

**Change-type → icon + accent** (color is *never* the only signal — icon + label always present, per `granularity-layouts.md` §6):

| `change_type` | icon | accent role |
|---------------|------|-------------|
| `migration` | database | structural/schema |
| `api_contract` | plug | contract |
| `ui_component` | layout | surface |
| `logic` / `refactor` | function | behavior |
| `bugfix` | bug | corrective |
| `config` | sliders | configuration |
| `infra` | server | platform |
| `test` / `docs` | check / doc | supporting |

**`node_status` → color + treatment** (drives border/fill; mirrored as an icon+label badge):

| `node_status` | treatment |
|---------------|-----------|
| `pending` | muted/dashed border |
| `ready` | solid neutral; Run enabled |
| `running` | pulsing accent border + live progress bar (from `stream:run:{id}`) |
| `built` | green check; "view diff" affordance |
| `merged` | filled green; locked |
| `failed` | red border + error glyph; "retry / inspect" |
| `blocked` | amber + lock glyph; tooltip names the blocker (lock or unmet edge) |
| `skipped` | greyed, struck |

**Emphasis & confidence.** `LayoutSpec.emphasis` (e.g. `["contracts","tests"]`) renders as small badges on the face and selects the inspector's default tab. `plan_nodes.confidence` renders as a 0–1 dot meter; **low confidence** (below threshold) adds a visible `low-confidence` chip (honesty principle, `genui-philosophy.md` §5.5).

**Props:** `PlanNodeData = { id, title, change_type, node_status, confidence, emphasis, branch_id, branch_independent, false_independence_refs?, progress?, isSelected, isMultiSelected, granularity }`.

## 3. Typed edge renderers (with evidence on hover)

One `edgeType` per `edge_type`, each visually distinct so dependency *kind* is readable at a glance:

| `edge_type` | styling | meaning |
|-------------|---------|---------|
| `depends_on` | solid, arrowhead, strong | hard prerequisite; downstream is `blocked` until upstream `built` |
| `data_flow` | solid, gradient along direction, small "data" glyph | a value/contract produced upstream is consumed downstream |
| `sequence` | solid thin, open arrowhead | ordering required but not a data dependency |
| `soft_order` | **dashed**, faint, no arrowhead | preference, not a constraint; hideable via density control |

**Evidence on hover** (D4-AC4). Hovering/focusing an edge shows a popover built from `plan_edges.evidence` and `rationale` — *why this dependency exists*:

```
 ┌─ why this edge ───────────────────────────────┐
 │ reason: symbol_dependency                       │
 │ shared:   src/auth/index.ts#login               │
 │ provides: createSession  →  consumes: createSession │
 │ overlap_score: 0.0  (safe to parallelize)       │
 │ rationale: "OAuth route calls createSession…"   │
 │ [ Ratify ]  [ Split edge ]  [ Remove ]          │  ← ties to engine, §6
 └─────────────────────────────────────────────────┘
```

The popover never invents a reason — it renders the engine's cited evidence or, if absent, labels the edge `unverified` (ground-or-fallback).

**Props:** `PlanEdgeData = { id, type, evidence, rationale, overlap_score, ratified }`.

## 4. Branch visualization & false-independence

- **Independent branches are visually distinct.** Each `branch` gets a stable tint; nodes carry their branch tint as a left bar (node face) and, in `swimlane_dag`, a lane. Branches with `independent_of` populated (proven independent) get a subtle "∥ parallel-safe" affordance and are eligible for **Dispatch parallel**.
- **Parallel-dispatchable selection is highlighted** (D9-AC2): selecting nodes/branches that are mutually independent lights a "⚡ N branches parallel-safe" banner; selecting overlapping ones shows why they cannot.
- **False-independence ⚠ inline** (D4-AC3, honesty principle). When the engine flags two "independent" branches sharing a file / mutated symbol / changed signature / schema or config key, the canvas renders an **inline ⚠ marker on the implicated nodes and an annotation between the lanes** naming the conflicting symbol — e.g. `⚠ web↔api share checkout.ts → serialized` (mirrors `granularity-layouts.md` G3 wireframe). The ⚠ is sourced from engine evidence, never heuristic guessing.

## 5. Layout-strategy switching (from `LayoutSpec.canvas`)

The canvas is a thin renderer over a **layout strategy** selected by `LayoutSpec.canvas`. Each strategy is a pure `(nodes, edges, LayoutSpec) → positioned nodes + edges + frame chrome`. (This is the deterministic-from-spec principle: same spec → same layout.)

| `LayoutSpec.canvas` | strategy | engine | frame chrome |
|---------------------|----------|--------|--------------|
| `checklist` (G1) | vertical list; DAG collapsed; 1 node ⇒ canvas *is* inspector | manual stack | "Share diff" only |
| `compact_dag` (G2) | left→right (or `direction`) DAG | **dagre** | branch-buttons; "Run all", "Add context" |
| `swimlane_dag` (G3) | lanes by `grouping=by_module`; integration nodes explicit | dagre per-lane + custom swimlane band | "Dispatch parallel ⚡"; conflict guard; assignee avatars |
| `hierarchical_map` (G4) | clustered super-nodes; `grouping=by_milestone` lanes | **elk.js** hierarchical clustering | minimap; semantic zoom; "Assign clusters" |

- **`direction`** (`LR`/`TB`) and **`grouping`** come straight from `LayoutSpec`; **`parallelism_ui`** and **`delegation_ui`** select which action chrome mounts (`hidden` / `branch_buttons` / `dispatch_parallel` / `assign_clusters`; `share_diff` / `per_branch` / `per_lane` / `assign_clusters`).
- **Re-flow on change** (the loop's stage 4, `genui-philosophy.md` §4): a tier flip / re-plan / drift re-emits `LayoutSpec`; the canvas **animates** node positions to the new strategy (`realtime-ui.md`) rather than hard-cutting.

### Semantic zoom + minimap (G4)

- **Super-nodes**: a `plan_node` with `parent_node_id` children renders collapsed as a cluster showing **child count + roll-up status** (e.g. "Storage (9 nodes) · 3 built / 6 ready"). Clicking **expands** into its sub-DAG (a nested `compact_dag`/`swimlane_dag` view).
- **Semantic zoom** (`LayoutSpec.semantic_zoom=true`): at low zoom show clusters + counts only; descending reveals titles, then full faces. Detail level is a function of zoom, keeping G4 navigable.
- **Minimap** always available in G4 (and toggleable elsewhere); reflects branch tints for orientation.

## 6. Interactions (the operate + ratify surface)

The canvas is *operable* (philosophy: output is software). Interactions split into **operate** (run/dispatch/delegate, → orchestration) and **ratify** (edit the hypothesis, → dependency engine, Stage 7).

**Selection**
- **Select / multi-select** (click, shift-click, marquee). Multi-select computes mutual independence live and shows the parallel-safe banner (§4).
- Keyboard: arrows move focus between nodes, `Enter` opens inspector, `space` toggles select (a11y, `granularity-layouts.md` §6).

**Operate** (gated by `share_role`: `runner`+ can run; `viewer` read-only — `data-model.md` §4)
- **Run node** → enqueue `node-run` (`runs.kind=node_build`); face flips to `running`, live progress from `stream:run:{id}`.
- **Run branch** → run all ready nodes in a `branch` respecting `depends_on` order.
- **Dispatch parallel ⚡** → select all proven-independent branches and enqueue them concurrently; the file-overlap lock (`lock:file:{project}:{path}`) serializes any accidental overlap with a visible reason (D6-AC2).
- **Delegate subtree** → select a subtree root → export a portable spec (`delegations`, D14) via `delegation_ui`.

**Ratify** (editor role; ties to the dependency engine, `dependency-inference-engine.md` Stage 7 — the user-correctable hypothesis)
- **Ratify edge/independence** → mark an engine claim accepted (`plan_edges.ratified`); logged to improve the engine.
- **Add edge** → draw a new dependency between nodes; the engine records it as a user-asserted edge (evidence `reason: user_asserted`) and re-derives branches.
- **Split edge** → interpose a node (e.g. insert an integration step) on an existing edge.
- **Override independence** → demote a "parallel-safe" pair the user knows conflicts, or promote a flagged pair the user verified safe; re-partitions branches and re-flows.

All ratify actions **re-run partitioning** and **re-flow** the canvas; all are **optimistic** then server-reconciled (§7).

## 7. State, realtime, and optimistic edits

- **Zustand** holds canvas/UI state: `selection`, `multiSelection`, `layoutMode` (mirrors `LayoutSpec.canvas`), `density` (collapsed chips / hidden soft edges / focused branch), `expandedSuperNodes`, `viewport`, and an **optimistic-edit overlay**.
- **TanStack Query** owns server state (plan, nodes, edges, branches, runs) — the source of truth that realtime invalidates.
- **Supabase Realtime** subscribes to `plan_nodes` / `plan_edges` / `branches` / `runs` change feeds for **durable** updates (D12-AC1): another user's edit, a node flipping to `built`, a new revision. **Redis Streams** (`stream:run:{id}`) drive **ephemeral high-frequency** signal — live progress bars, token counts, streamed diff chunks — straight into node faces (per `tech-stack.md` §5: durable vs. ephemeral split).
- **Presence** (`presence:plan:{id}`) renders collaborator cursors/avatars on the canvas.
- **Optimistic UI** (D12-AC2): user edits (move node, add/split edge, ratify) apply instantly to the Zustand overlay; the mutation posts to the API; the server reconciles and Realtime confirms (or rolls the overlay back with a toast).

## 8. Performance for large graphs (G3/G4)

- **Viewport virtualization**: only render nodes/edges intersecting the viewport (+ margin); React Flow `onlyRenderVisibleElements`. Off-screen nodes are layout-positioned but not mounted.
- **Super-node collapse** (G4): clusters render as one node until expanded, bounding mounted count regardless of total plan size; over a node cap the plan **auto-clusters** (`granularity-layouts.md` §7 edge cases).
- **Level-of-detail** via semantic zoom: low zoom → cluster shells only; mid → titles; high → full faces with live bars. Live progress bars subscribe to streams **only for visible running nodes**.
- **Memoized layout**: layout strategies are pure and cached per `(plan revision, canvas, density)`; `plan_nodes.position` persists the last layout so re-open is instant. Recompute is debounced and runs off the main thread where feasible.
- **Edge batching**: `soft_order` edges hidden by default at G3/G4 (density control) to cut edge count; reveal on demand.

## 9. Component / prop breakdown

```
<GraphCanvas planId revision>                         // top-level; subscribes realtime, owns Zustand store
  ├── <CanvasToolbar layoutSpec onAddContext onDispatchParallel/>   // chrome from parallelism_ui/delegation_ui
  ├── <ReactFlow nodeTypes edgeTypes onSelectionChange ...>
  │     nodes  = useLayout(strategy=layoutSpec.canvas)   // pure strategy selected by LayoutSpec
  │     ├── <PlanNode data: PlanNodeData/>               // §2 face; per change_type + node_status
  │     │     ├── <ChangeTypeBadge/> <StatusBadge/> <ConfidenceMeter/> <FalseIndepFlag/>
  │     │     ├── <EmphasisBadges/>  <BranchTintBar/>    // from LayoutSpec.emphasis / branch
  │     │     └── <NodeQuickActions onRun onDelegate onOpenInspector/>
  │     ├── <SuperNode/>                                 // collapsed cluster (G4); expand → sub-DAG
  │     ├── <IntegrationNode/>                           // reconvergence (◆), from integration_nodes
  │     └── <PlanEdge data: PlanEdgeData/>               // §3 typed; <EvidencePopover/> on hover
  ├── <SwimlaneBands grouping/>                          // G3 only; lanes by module + assignee avatars
  ├── <Minimap/>                                         // G4 (toggle elsewhere)
  ├── <SelectionBanner parallelSafeCount conflicts/>     // §4 multi-select feedback
  ├── <PresenceLayer/>                                   // collaborator cursors/avatars
  └── <DensityControls/>                                 // collapse chips · hide soft edges · focus branch
```

- `useLayout(strategy)` → the §5 strategy table; returns positioned nodes/edges + frame chrome flags.
- `usePlanRealtime(planId)` → wires Supabase Realtime + Redis stream subscriptions into TanStack Query / Zustand.
- `useSelection()` → selection + live independence computation for the parallel-safe banner.
- `useRatify()` → ratify/add/split/override mutations → dependency engine (Stage 7) → re-partition → re-flow.

**Empty/degraded states**: empty plan (G1, 0 changes) → "no changes needed — here's why" panel; small screens → degrade to vertical list with graph behind a toggle (`granularity-layouts.md` §6/§7); offline/realtime-drop → stale banner + read-only until reconnect.

---

## To-do list

### Rendering
- [ ] `PlanNode` renderer: change_type icon set + node_status treatments + confidence meter + emphasis badges (icon+label, never color-only).
- [ ] Live progress bar on `running` nodes from `stream:run:{id}` (visible nodes only).
- [ ] Typed `PlanEdge` renderers for `depends_on` / `data_flow` / `sequence` / `soft_order` with distinct styling.
- [ ] `EvidencePopover` from `plan_edges.evidence` + `rationale`; `unverified` fallback when evidence absent.
- [ ] `SuperNode` (roll-up status) + `IntegrationNode` (◆) renderers.

### Branches & honesty
- [ ] Branch tinting + parallel-safe affordance from `branches.independent_of`.
- [ ] False-independence ⚠ inline markers + inter-lane annotation citing the conflicting symbol.
- [ ] Parallel-dispatchable selection highlight + "⚡ N branches parallel-safe" banner.

### Layout
- [ ] `useLayout` strategy switch: `checklist`, `compact_dag` (dagre LR/TB), `swimlane_dag`, `hierarchical_map` (elk.js).
- [ ] Chrome wiring from `parallelism_ui` / `delegation_ui` / `emphasis`.
- [ ] Semantic zoom + super-node expand/collapse + minimap (G4).
- [ ] Re-flow animation on tier change / re-plan / drift.

### Interactions
- [ ] Select / multi-select (click, shift, marquee) + keyboard nav (a11y).
- [ ] Operate: Run node, Run branch, Dispatch parallel, Delegate subtree (role-gated).
- [ ] Ratify / add edge / split edge / override independence → dependency engine (Stage 7) → re-partition.

### State, realtime, perf
- [ ] Zustand canvas store (selection, layoutMode, density, expanded super-nodes, optimistic overlay).
- [ ] TanStack Query server state + Supabase Realtime invalidation + Redis stream subscriptions.
- [ ] Optimistic edits with server reconciliation + rollback toast.
- [ ] Presence layer (cursors/avatars).
- [ ] Viewport virtualization + LOD + memoized/persisted layout + auto-cluster over node cap.
- [ ] Visual-regression tests per tier × representative change-types (with `granularity-layouts.md`).

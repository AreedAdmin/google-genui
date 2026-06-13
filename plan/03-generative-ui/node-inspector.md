# Node Inspector (the five-section detail panel)

> Status: **Canonical.** Specifies the node detail panel (**D10**) — the change-type `WidgetSpec` at the top plus the five grounded sections (Changes · Assumptions · Analysis · Benefits · Notable variables & objects) — sourced from `node_annotations`, with citations, per-claim feedback, streaming, confidence, a diff viewer, and per-granularity layouts.

This is axis B (change_type + context → node body) of the [generative-UI philosophy](./genui-philosophy.md) made concrete. The inspector renders the validated `WidgetSpec[]` from [`widget-generation.md`](./widget-generation.md) and the five-section content from `node_annotations` (`data-model.md` §2). Defaults (which tab opens, what's emphasized) come from the plan's `LayoutSpec` ([`granularity-layouts.md`](./granularity-layouts.md) §3). It obeys the principles in [`genui-philosophy.md`](./genui-philosophy.md) §5 — never-raw-HTML, ground-or-fallback, confidence surfaced, low-confidence labeled.

## 1. Anatomy

The inspector opens as a right-hand panel (or, at G1 with one node, *is* the canvas — `granularity-layouts.md` §2). Top to bottom:

```
┌─ Node Inspector ─────────────────────────────────── ✕ ┐
│ ◷ api_contract   POST /auth/oauth        ●●●○ 0.74    │  ← header: change_type · title · confidence
│ status: ready   branch A (∥ independent)              │
│ [ ▶ Run ]  [ Share ]  [ Delegate subtree ]  [ + Add context ]   │  ← action bar (§3)
├───────────────────────────────────────────────────────┤
│ ╔═ change-type widget (WidgetSpec) ═════════════════╗ │  ← §4: api-contract / schema-diff /
│ ║  POST /auth/oauth                                  ║ │     component-preview / call-graph-impact
│ ║  req {code, provider}  →  res 200 {session}  …     ║ │     (validated; rendered from registry)
│ ╚════════════════════════════════════════════════════╝ │
├───────────────────────────────────────────────────────┤
│ ▸ Changes · ▸ Assumptions · ▸ Analysis · ▸ Benefits · ▸ Notable │  ← §2 tabs/sections
│   (default tab from LayoutSpec.default_inspector_tab)  │
│   …section content with citations + 👍/👎 per claim…   │
├───────────────────────────────────────────────────────┤
│ ▸ Diff (built nodes)   ▸ Comments (n)                  │  ← §7 diff viewer · §8 thread
└───────────────────────────────────────────────────────┘
```

## 2. The five sections (from `node_annotations`)

The five sections are **D10-AC1** and carry the **P2 grounded analysis** (D5). Each is sourced from the `node_annotations` row for the node's current `revision` (`data-model.md` §2). Per `genui-philosophy.md` §5, **every claim cites a real symbol/file or is labeled `low-confidence`.**

| Section | Source field | JSON shape (from `data-model.md`) | Renders as |
|---------|--------------|-----------------------------------|------------|
| **Changes** | `plan_nodes.touch_set` (+ resolved symbols) | `{ predicted:{add,modify,delete}, resolved:{files,symbols,signatures_changed,schema_keys,config_keys}, resolution_confidence }` | grouped add/modify/delete list with file·symbol citations; signature-change callouts |
| **Assumptions** | `node_annotations.assumptions` | `[{ text, grounded_refs[], confidence }]` | claim rows; each ref is a citation link; confidence chip |
| **Analysis** (risks) | `node_annotations.analysis` | `[{ kind: race_condition\|failure_mode\|edge_case\|perf\|security, text, grounded_refs[], severity, confidence }]` | severity-sorted rows grouped by `kind`; severity glyph; citations |
| **Benefits** | `node_annotations.benefits` | `[{ text, grounded_refs[] }]` | concise value statements with citations |
| **Notable variables & objects** | `node_annotations.notable_symbols` | `[{ symbol, file, role, why_notable }]` | symbol chips → click to the cited code |

**Citations** (D10-AC2). Every `grounded_refs[]` entry is a `file#symbol` reference rendered as a **citation link**; clicking opens the cited code (in the Diff viewer for built nodes, or a read-only code peek otherwise), scrolled to the symbol. A claim **with no grounded ref** renders a `low-confidence` label and muted styling — never as confident fact (ground-or-fallback, honesty principle).

**Confidence** is surfaced per claim (the `confidence` field) and per node (`plan_nodes.confidence`, header meter). Below threshold ⇒ explicit `low-confidence` chip.

## 3. Action bar

Buttons are role-gated (`share_role`, `data-model.md` §4):

| Button | Action | Wires to |
|--------|--------|----------|
| **▶ Run** (node) | enqueue a `node-run` (`runs.kind=node_build`) for this node | builder/orchestration; header flips to `running`, diff streams in (§6) — runner+ |
| **Share** | share the plan/node (viewer/runner/editor) | `shares` (D13) |
| **Delegate subtree** | export this node's subtree as a portable spec | `delegations` (D14) — editor |
| **+ Add context** | open the iteration panel; user adds context → live re-plan | `replan` (D8); on new `revision` the inspector re-binds to the new annotations (§6) — editor |

## 4. The change-type widget (top of the inspector)

The top region renders the node's `change_type` widget from the validated `node_annotations.widget_specs` (`WidgetSpec[]`). This is the same axis-B mapping as `granularity-layouts.md` §4; the registry resolves the spec to a trusted component (never raw model output — `genui-philosophy.md` §5.1):

| `change_type` | widget | renders |
|---------------|--------|---------|
| `migration` | **schema-diff** | before/after table/column structure; ordering vs. other migrations |
| `api_contract` | **api-contract** | endpoint, request/response shapes, status codes, breaking-change flags |
| `ui_component` | **component-preview** | rendered/skeleton preview + prop table + states |
| `logic` / `refactor` | **call-graph-impact** | the symbol, its callers, blast radius from the engine |
| `bugfix` / `config` / `infra` / `test` / `docs` | test-linkage / key-diff / resource-diagram / checklist-markdown | (phase-2 widgets; `widget-generation.md`) |

If a `WidgetSpec` fails validation or cannot be grounded, the inspector **falls back** to the markdown/`logic` widget and flags it for the registry backlog — it never renders an ungrounded fabrication (`granularity-layouts.md` §5.3, §7).

## 5. Per-claim feedback (the trust loop)

Each claim row (Assumptions / Analysis / Benefits) carries **👍 / 👎** (D5-AC3). A vote writes to the `feedback` table (`data-model.md` §2: `{ node_id, annotation_path, vote, reason? }`) where `annotation_path` points at the specific claim (e.g. `analysis[2]`). 👎 with an optional reason feeds **suppression of analysis patterns** (`analysis-annotation-agent.md`). Votes are optimistic (instant UI), then reconciled.

## 6. Streaming, confidence, and re-bind

- **Streaming-in of analysis** (skeleton → filled). When analysis is generating (`runs.kind=analysis` in flight), sections render **skeletons**; as `node_annotations` populates (via Redis stream / Realtime), claims **stream in** and replace skeletons in place. The change-type widget renders as soon as its `WidgetSpec` validates; sections fill independently.
- **Confidence display**: header confidence meter (`plan_nodes.confidence`) + per-claim chips; `low-confidence` labeling per §2.
- **Re-bind on re-plan**: when **Add context** produces a new `revision`, the inspector re-binds to the new `node_annotations`/`touch_set`/`widget_specs` for that revision and shows a "revised — diff vs. previous" affordance (ties to `replan-and-drift.md`); votes/comments persist across revisions where the claim is unchanged.

## 7. Diff viewer (built nodes)

When `node_status ∈ {built, merged}`, the **Diff** section renders the produced diff (`plan_nodes.diff_artifact_path`, bucket `diffs`) in **Monaco** (interactive) or **Shiki** (lightweight render), per `tech-stack.md` §1. Citation links from the five sections that point into changed files deep-link here, scrolled to the symbol. While a node is `running`, diff **chunks stream** from `stream:run:{id}` into the viewer (live build).

## 8. Comments thread

A **Comments** section renders the `comments` thread for the node (`{ author, body, resolved }`, `data-model.md` §2) with resolve/unresolve, author avatars, and presence — supporting collaborative review (D12). Optimistic post + Realtime sync.

## 9. Layout per granularity tier

The inspector's **density** follows the plan's tier (`LayoutSpec`), consistent with progressive disclosure (`genui-philosophy.md` §5.4):

- **G1 (Micro) — compact.** Opens directly to **Changes / the diff** (`default_inspector_tab="changes"`); Assumptions/Analysis/Benefits collapse to **chips** ("Assumptions (2) · Risks (1) · Benefits (1)") that expand on click. The change-type widget is present but secondary to the diff. (Mirrors `granularity-layouts.md` G1 wireframe.)
- **G2 (Meso) — full, contract-first.** Opens to the **change-type widget** (e.g. api-contract) per `emphasis=["contracts","tests"]`; all five sections expanded; this is the sweet-spot, fully-detailed card.
- **G3 (Macro) — full + cross-node.** As G2, plus cross-node interaction analysis surfaced in **Analysis** (e.g. shared-file risks with the other lane), and the branch/integration context shown in the header.
- **G4 (Mega) — descended view.** The inspector opens for a leaf node after descending from a super-node; it carries breadcrumb context (cluster/milestone) in the header; otherwise renders as G2/G3 for the leaf's own `change_type`.

`default_inspector_tab` and the emphasis ordering always come from `LayoutSpec` — the inspector does not hard-code which tab opens.

## 10. Component / prop breakdown + states

```
<NodeInspector nodeId revision>                         // binds node + node_annotations(revision)
  ├── <InspectorHeader node confidence/>                // change_type · title · status · branch · confidence meter
  ├── <ActionBar role onRun onShare onDelegate onAddContext/>   // §3, role-gated
  ├── <ChangeTypeWidget specs=node_annotations.widget_specs/>   // §4 — registry-resolved; fallback on invalid
  ├── <SectionTabs default=LayoutSpec.default_inspector_tab density=tier>
  │     ├── <ChangesSection touchSet/>                  // add/modify/delete + signature callouts + citations
  │     ├── <AssumptionsSection items/>                 // claim rows + <Citation/> + <ConfidenceChip/> + <ClaimFeedback/>
  │     ├── <AnalysisSection items/>                    // grouped by kind, severity-sorted; same row affordances
  │     ├── <BenefitsSection items/>
  │     └── <NotableSymbolsSection items/>              // symbol chips → code peek
  ├── <DiffViewer artifactPath engine=monaco|shiki/>    // §7 — built/merged; streams while running
  └── <CommentsThread nodeId/>                          // §8
shared: <Citation refs=grounded_refs onJump/>  ·  <ConfidenceChip value/>  ·  <ClaimFeedback path onVote/>  ·  <ClaimSkeleton/>
```

**Props of note:** `InspectorProps = { nodeId, revision, layoutSpec, role }`. `Citation` takes `file#symbol` refs and an `onJump` (to DiffViewer or code peek). `ClaimFeedback` takes the `annotation_path` for the `feedback` write.

**States** (every section): `loading` (skeleton, while analysis streams) → `filled` · `low-confidence` (no grounded ref → labeled + muted) · `empty` (no items → "none surfaced") · `stale` (superseded by a newer revision → "revised, view diff") · `error` (analysis run failed → retry). The change-type widget adds: `validating` → `rendered` · `fallback` (invalid/ungrounded spec → markdown widget + backlog flag).

---

## To-do list

### Five sections + citations
- [ ] `ChangesSection` from `touch_set` (predicted+resolved) with add/modify/delete grouping + signature-change callouts.
- [ ] `AssumptionsSection`, `AnalysisSection` (grouped by `kind`, severity-sorted), `BenefitsSection`, `NotableSymbolsSection` from `node_annotations`.
- [ ] Shared `<Citation>` resolving `grounded_refs` (`file#symbol`) → jump to DiffViewer / code peek.
- [ ] `low-confidence` labeling for any claim lacking a grounded ref (honesty principle).

### Widget + actions
- [ ] `ChangeTypeWidget` rendering validated `WidgetSpec[]` from the registry; fallback to markdown/`logic` on invalid/ungrounded + backlog flag.
- [ ] Action bar: Run / Share / Delegate subtree / Add context — role-gated; wired to runs/shares/delegations/replan.
- [ ] `default_inspector_tab` + emphasis ordering driven from `LayoutSpec` (no hard-coded default).

### Trust, streaming, confidence
- [ ] Per-claim 👍/👎 → `feedback` table (`annotation_path`); optimistic + reconcile; feeds suppression.
- [ ] Streaming-in: claim skeletons → filled from analysis run (Redis stream / Realtime).
- [ ] Confidence: header meter (`plan_nodes.confidence`) + per-claim chips.
- [ ] Re-bind to new `revision` on Add-context re-plan; "revised — diff vs. previous"; persist votes/comments where unchanged.

### Diff + comments + tiers
- [ ] `DiffViewer` (Monaco/Shiki) for built/merged nodes from `diff_artifact_path`; live chunk streaming while `running`; citation deep-links.
- [ ] `CommentsThread` (resolve/unresolve, presence) — optimistic + Realtime.
- [ ] Per-tier density: G1 compact/diff-first w/ collapsed chips; G2/G3 full; G3 cross-node analysis; G4 breadcrumb context.
- [ ] Section state machine: loading / filled / low-confidence / empty / stale / error; widget validating / rendered / fallback.

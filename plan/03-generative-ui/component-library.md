# Component Library — The Trellis Design System

> Status: **Canonical.** Defines the Tailwind + shadcn/ui (Radix) design system — tokens, the per-`change_type`/`status` node visual language, edge styles, indicators, and the shared primitives that the canvas, inspector, and generated widgets all compose from.

This is the **shared substrate** beneath the two generative-UI axes. The canvas ([`graph-canvas.md`](./graph-canvas.md)), the inspector ([`node-inspector.md`](./node-inspector.md)), the granularity layouts ([`granularity-layouts.md`](./granularity-layouts.md)), the generated widgets ([`widget-generation.md`](./widget-generation.md)), realtime ([`realtime-ui.md`](./realtime-ui.md)), and collaboration ([`collaboration-ui.md`](./collaboration-ui.md)) all build from these primitives. **Generated widgets do not invent their own styling** — they assemble registry components from this system, which is *why* generative UI here is safe and consistent.

Stack per [tech-stack §1](../01-architecture/tech-stack.md): **Tailwind CSS + shadcn/ui (Radix primitives)**, themed via CSS variables.

---

## 1. Design tokens

Tokens are CSS variables consumed by Tailwind (`tailwind.config` maps `colors`/`spacing`/`fontSize` to `var(--…)`). One source of truth; theming (§7) swaps the values, not the components.

### Color (semantic, not literal)
Never reference raw hex in components — only semantic tokens, so dark mode and contrast are centralized.

```
--bg            page background          --fg            primary text
--surface       card/panel background    --fg-muted      secondary text
--surface-2     nested panel             --border        hairlines/dividers
--primary       brand / primary action   --ring          focus ring (≥3:1 vs adjacent)
--accent        selection / highlight     --overlay       scrim for dialogs
```

**Status & change-type hues** are tokenized per §2/§3 (`--status-running`, `--ct-migration`, …) so the node language is themeable and never hard-coded.

### Spacing & radius
4px base scale: `space-1..12` → `4,8,12,16,20,24,32,40,48`. Radii: `rounded-sm 4 / md 6 / lg 10 / xl 14`. Nodes use `lg`; panels `xl`; chips/badges `full` or `sm`.

### Type
`Inter` (UI) + `JetBrains Mono` (code/diffs/symbols). Scale: `xs 12 / sm 13 / base 14 / md 15 / lg 18 / xl 22 / 2xl 28`. UI body is `sm`–`base`; symbol/code tokens are mono `xs`–`sm`. Line-height 1.5 body, 1.35 dense tables.

### Elevation
Flat by default; elevation only for things that float: `shadow-card` (panels), `shadow-pop` (popovers/menus), `shadow-modal` (dialogs). The canvas itself is flat — depth is conveyed by hairlines + selection ring, not drop shadows (keeps a busy DAG legible).

### Motion
`--motion-fast 120ms`, `--motion-base 200ms`, `--motion-flow 400ms` (re-flow animations, see [`realtime-ui.md`](./realtime-ui.md)). All wrapped so `prefers-reduced-motion` collapses them to near-instant cross-fades.

---

## 2. Node visual language (by `change_type` & `status`)

A node's appearance is a **product of two orthogonal signals**: *what kind of change* (`change_type` → icon + accent hue) and *where it is in its lifecycle* (`status` → border treatment + status pill). This makes the canvas scannable at a glance and is the visual root of the change-type genUI axis.

### `change_type` → icon + accent (the 10 canon types)
Accent appears as a **left edge bar + icon tint**, never as the whole node fill (keeps status readable on top).

| `change_type` | Icon (lucide) | Accent token | Reads as |
|---------------|---------------|--------------|----------|
| `migration` | `database` | `--ct-migration` (violet) | schema/data |
| `api_contract` | `plug` | `--ct-api` (blue) | interface/contract |
| `ui_component` | `layout` | `--ct-ui` (cyan) | front-end |
| `logic` | `function-square` | `--ct-logic` (slate) | core logic |
| `refactor` | `git-branch` | `--ct-refactor` (teal) | restructure |
| `bugfix` | `bug` | `--ct-bugfix` (amber) | defect |
| `config` | `sliders` | `--ct-config` (zinc) | settings |
| `infra` | `server` | `--ct-infra` (indigo) | platform |
| `test` | `flask-conical` | `--ct-test` (green) | verification |
| `docs` | `file-text` | `--ct-docs` (gray) | documentation |

### `node_status` → border + pill (the canon enum)
Icon + label **always together** — color is never the only signal (a11y, §8). The pill carries an icon, a word, and the hue.

| `node_status` | Pill | Border | Indicator |
|---------------|------|--------|-----------|
| `pending` | ○ Pending | dashed muted | idle |
| `ready` | ▸ Ready | solid border | ready-to-run |
| `running` | ◐ Running | animated/pulsing ring | spinner + live |
| `built` | ✓ Built | solid success | check |
| `merged` | ⛢ Merged | solid, dimmed | merged-into-base |
| `failed` | ✕ Failed | solid danger | error |
| `blocked` | ⚷ Blocked | solid warning | upstream not done |
| `skipped` | ⊘ Skipped | dotted muted | excluded |

### Node anatomy (ASCII)
```
┌▌─────────────────────────────────────────┐   ▌ = change_type accent bar
│▌ 🔌 Add /auth/oauth route   ◐ Running     │   icon + title + status pill
│▌ ───────────────────────────────────────  │
│▌ api_contract · branch B · conf 0.88 ●●●○ │   meta row: type · branch · confidence dots
│▌ ⚠ breaking ·  ⓘ 3 assumptions            │   inline flags (badges)
│▌ [Run ▸]  [Open]                  @alice   │   actions + assignee avatar
└▌──────────────────────────────────────────┘
   selected → 2px --ring outline; focus → same ring (keyboard parity)
```

Super-nodes (G4) use the same shell with a count badge (`12 nodes`) and an aggregate status pill (worst-of children) per [`granularity-layouts.md` §2](./granularity-layouts.md).

---

## 3. Edge visual language (by `edge_type`)

Edges encode dependency semantics + parallel-safety. The canon `edge_type` enum maps to stroke style; **`overlap_score`** ([`data-model` plan_edges](../01-architecture/data-model.md)) maps to a conflict glyph.

| `edge_type` | Stroke | Arrow | Meaning |
|-------------|--------|-------|---------|
| `depends_on` | solid `--border-strong` | filled ▶ | hard build dependency |
| `data_flow` | solid `--ct-api` | open ▷ | data passes between nodes |
| `sequence` | solid, thicker | filled ▶▶ | must run in order |
| `soft_order` | dashed muted | open ▷ | preferred order, not required (hideable via density control) |

- **Overlap / false-independence**: an edge whose `overlap_score > 0` (or a flagged shared file) gets a `⚠` mid-edge glyph + a warning tint; hover shows the shared symbols (the engine's `evidence`). This is the visible honesty signal from [scope §7](../00-overview/scope.md).
- **Live edges** (a dependency satisfied/violated during a run) animate a one-shot pulse (see [`realtime-ui.md`](./realtime-ui.md)); reduced-motion shows a static state change.
- Edges carry an ARIA label (`"<from> depends on <to>, shares 2 files"`) for the keyboard graph walker.

---

## 4. Status, confidence & grounding indicators

These are the trust surface — used by nodes, the inspector, and every `WidgetFrame` ([`widget-generation.md` §3](./widget-generation.md)).

- **StatusPill** — icon + word + hue (§2). Never color-only.
- **ConfidenceMeter** — a 4-dot scale (`●●●○`) + a tooltip with the numeric `confidence` and *why*. < 0.5 renders muted with a "low confidence" label; this is the same signal the low-confidence widget banner uses.
- **GroundingChip** — `grounded · N refs · 0.86 ▾`, expands to the cited symbols/files; each ref is a clickable token. Structurally present on every widget via `WidgetFrame`.
- **SeverityTag** — for `analysis` items (`race_condition`/`failure_mode`/…): `low`/`medium`/`high` with icon + hue, ordered high→low.
- **BreakingFlag** — `⚠ breaking` chip on api-contract nodes/widgets; click scrolls to the breaking-change list.

---

## 5. Shared primitives (the inventory)

shadcn/ui gives the Radix-backed base (Dialog, Popover, Tooltip, Tabs, DropdownMenu, Toast, ScrollArea, Avatar, Command, …). Trellis-specific composites layer on top. **Generated widgets compose only from this set** — they never introduce raw elements.

### Component inventory

| Component | Base | Used by | Notes |
|-----------|------|---------|-------|
| `Button` | shadcn | everywhere | variants: primary / secondary / ghost / danger; sizes sm/md; loading state |
| `IconButton` | shadcn | canvas, toolbars | tooltip-required (a11y label) |
| `Badge` / `Chip` | shadcn | nodes, inspector | status/flags; removable chip variant for context tags |
| `StatusPill` | composite | nodes, runs, branches | icon+word+hue (§2) |
| `ConfidenceMeter` | composite | nodes, widgets, inspector | 4-dot + tooltip (§4) |
| `GroundingChip` | composite | every `WidgetFrame` | cited refs (§4) |
| `NodeCard` | composite | canvas | the node shell (§2 anatomy) |
| `EdgeRenderer` | React Flow custom | canvas | per-`edge_type` stroke + overlap glyph (§3) |
| `Panel` / `Section` | composite | inspector | titled collapsible region |
| `Tabs` | shadcn | inspector | the five sections + widget tab |
| `WidgetFrame` | composite | all widgets | grounding chip + low-conf banner + title/actions ([widget-gen §3](./widget-generation.md)) |
| `CodeBlock` / `DiffView` | Shiki/Monaco | diff, schema-diff, key-diff | mono, copy, line numbers; [tech-stack §1](../01-architecture/tech-stack.md) |
| `DataTable` | composite | api-contract, schema-diff | dense, sortable, change-tinted rows |
| `Avatar` / `AvatarStack` | shadcn | assignees, presence | overflow `+N`; tooltip names ([collaboration-ui](./collaboration-ui.md)) |
| `Cursor` / `PresenceLayer` | composite | canvas | live cursors ([realtime-ui](./realtime-ui.md)) |
| `Dialog` / `Sheet` | shadcn | share, delegate, settings | focus-trapped (§8) |
| `CommandPalette` | shadcn Command | global | `⌘K` actions |
| `Toast` | shadcn | global | run/share/conflict notifications |
| `EmptyState` | composite | canvas, inspector, feeds | icon + title + hint + action (§6) |
| `Skeleton` | shadcn | streaming loads | every widget ships one (§6, [realtime-ui](./realtime-ui.md)) |
| `ErrorState` | composite | widgets, panels | message + retry; never a blank crash |

---

## 6. Empty / loading / error / skeleton states

Every surface defines all four — no blank or crashing region. Generated content (which streams in, [`realtime-ui.md`](./realtime-ui.md)) especially needs first-class skeletons.

- **Skeleton** — every widget exposes `entry.Skeleton` ([widget-gen §3](./widget-generation.md)); the inspector shows section skeletons while analysis streams (skeleton → filled). Shapes mimic final layout (no layout shift).
- **Empty** — `EmptyState` with an icon, a one-line explanation, and the next action. Canon cases: G1 "no changes needed — here's why" ([layouts §7](./granularity-layouts.md)); empty comments/activity feed; a node with no widgets (rare — falls back to text summary).
- **Loading** — spinner only for indeterminate < 1s actions; otherwise skeleton. Run-in-progress uses the `running` pill + streaming logs, not a blocking spinner.
- **Error** — `ErrorState` with a human message + retry; a failed widget degrades to `FallbackWidget` (not an error) per [widget-gen §3](./widget-generation.md); a failed *panel* shows retry. The canvas never white-screens on one bad node.

---

## 7. Theming (light / dark)

- Single token set, two value maps (`:root` light, `.dark` dark); `next-themes` toggles `.dark` + respects system preference; SSR-safe (no flash).
- **All** color decisions route through tokens — including `change_type`/`status` hues — so dark mode is one map, not per-component overrides.
- Dark-mode hues are tuned for contrast on `--surface` (not just inverted), and re-verified against the §8 contrast targets. Diffs/code use theme-matched Shiki themes.
- The `component_preview` sandbox iframe receives the active theme tokens so previews match ([widget-gen §9](./widget-generation.md)).

---

## 8. Accessibility standards

Non-negotiable; the a11y pass is a [`granularity-layouts.md`](./granularity-layouts.md) to-do this doc implements.

- **Color is never the only signal** — status/confidence/severity/change-type always pair color with an icon **and** text (§2/§4). This is enforced in component code, not left to authors.
- **Contrast** — text ≥ 4.5:1 (≥ 3:1 large); UI/graphics (borders, icons, focus ring, edge strokes) ≥ 3:1. Token values are CI-checked.
- **Focus** — visible `--ring` (≥ 3:1) on every interactive element; selection and keyboard-focus share the ring so canvas keyboard nav is first-class. No focus traps except intended (dialogs trap + restore).
- **Keyboard** — full graph nav: arrow keys move node focus, `Enter` opens the inspector, `Tab` cycles inspector sections/widgets, `R` runs the focused node, `⌘K` palette. Edges are reachable in a "connections" list per node (the graph walker). Documented in [`graph-canvas.md`](./graph-canvas.md).
- **ARIA / SR** — canvas exposes a roled structure (nodes as listitems with computed labels incl. type/status/confidence; edges described in each node's connections); widgets carry `entry.a11yLabel` ([widget-gen §3](./widget-generation.md)); live regions announce run state + streamed completions politely.
- **Motion** — `prefers-reduced-motion` collapses re-flow/pulse animations to cross-fades.
- **Targets** — interactive hit areas ≥ 24×24 (≥ 44 on touch).

---

## 9. Iconography

- **lucide-react** only (single weight/grid; tree-shaken). `change_type` icon map is canon (§2); `status` glyphs are canon (§2). One icon per concept across the app (a `database` always means migration/schema).
- Icons are decorative-by-default (`aria-hidden`) when paired with text; standalone icon buttons require an `aria-label`.
- Sizes: 14 (inline/chips), 16 (node/buttons), 20 (panels), 24 (empty states).

---

## 10. Storybook plan

Storybook is the design-system workbench **and** the visual-regression source (pairs with [widget-gen §11](./widget-generation.md)).

- **Foundations** stories: tokens (color/spacing/type swatches), light/dark side-by-side, contrast report.
- **Primitives**: one story per inventory row (§5) with all variants/states (default/hover/focus/disabled/loading).
- **Node & edge language**: a matrix story rendering every `change_type` × every `node_status`, and every `edge_type` × overlap on/off — the visual contract for §2/§3.
- **Widgets**: each registry widget gets stories from its `fixtures` (default/loading/error/low-confidence), in both themes — these are the visual-regression baselines.
- **States**: empty/loading/error/skeleton gallery.
- **A11y**: `@storybook/addon-a11y` runs axe on every story in CI; contrast + role checks gate merges.
- **Visual regression**: Chromatic (or Playwright snapshots) on the Storybook build per PR; diffs require sign-off.

---

## To-do list

### Tokens & theming
- [ ] Token set (color/spacing/radius/type/elevation/motion) as CSS variables + Tailwind mapping.
- [ ] Light/dark value maps via `next-themes`; SSR no-flash; dark hues tuned + contrast-checked.
- [ ] `change_type` accent tokens + `status`/severity hue tokens (themeable, never hard-coded).

### Node / edge visual language
- [ ] `NodeCard` shell with change_type accent bar + icon + StatusPill + meta row + assignee.
- [ ] Super-node variant (count badge + aggregate status) for G4.
- [ ] `EdgeRenderer` per `edge_type` + overlap `⚠` glyph + evidence-on-hover + live-pulse.

### Primitives & indicators
- [ ] StatusPill, ConfidenceMeter, GroundingChip, SeverityTag, BreakingFlag (icon+label, never color-only).
- [ ] Inventory composites: Panel/Section, WidgetFrame, DataTable, CodeBlock/DiffView, AvatarStack, PresenceLayer/Cursor, EmptyState, Skeleton, ErrorState.
- [ ] Wire shadcn/ui base (Dialog, Sheet, Tabs, Popover, Tooltip, Command, Toast, ScrollArea).

### A11y & states
- [ ] Color-is-never-only-signal enforced in component code; CI contrast check on tokens.
- [ ] Focus ring parity (selection == keyboard focus); dialog focus trap+restore.
- [ ] Keyboard graph nav + roled ARIA structure + live regions.
- [ ] Empty/loading/error/skeleton for every surface; per-widget skeletons.

### Iconography & Storybook
- [ ] lucide icon map (canon per change_type/status); standalone-icon a11y labels.
- [ ] Storybook: foundations, primitives, node×status & edge×overlap matrices, widget fixtures (both themes).
- [ ] `addon-a11y` (axe) in CI + Chromatic/Playwright visual regression gating PRs.

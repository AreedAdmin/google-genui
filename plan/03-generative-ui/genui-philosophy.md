# Generative-UI Philosophy (the conceptual anchor)

> Status: **Canonical.** Defines what "generative UI" *means* in Trellis — agents emit a validated `LayoutSpec` + `WidgetSpec` rendered from a trusted component registry — and why that is real generative UI, not a chatbot decorated with cards; every other UI doc cites this.
>
> **Amended by [mandated-integrations.md](../01-architecture/mandated-integrations.md)** — the "spec, not raw UI" stance is **unchanged**; specs are now delivered over **AG-UI** and rendered via **CopilotKit headless generative UI**, still validated against the trusted registry — never a chatbot. See §6.

## 1. The core stance

> **The agent does not write the UI. The agent writes a *spec* for the UI, and a trusted renderer turns that spec into the UI.**

Concretely, the planning and analysis agents emit two kinds of structured artifact:

- a **`LayoutSpec`** for the whole plan — *how this plan should be presented* (the canvas), driven by **granularity** (see [`granularity-layouts.md`](./granularity-layouts.md) §3); and
- a **`WidgetSpec[]`** per node — *what this node's body should contain* (the widgets), driven by **`change_type` + extracted context** (see [`granularity-layouts.md`](./granularity-layouts.md) §4, [`widget-generation.md`](./widget-generation.md)).

Both are **validated against a component registry** (zod in TS, mirrored from the shared JSON Schema) **before** anything renders. The client then composes the interface from **trusted, design-system components** keyed by the spec. The model chooses *which* components and *with what grounded data*; it never ships markup, styles, or behavior.

```
        intent + repo index
               │
        ┌──────▼───────┐
        │  Planner /    │   emit  ┌───────────────┐
        │  Analysis     │────────▶│  LayoutSpec   │   structured artifact,
        │  agents        │         │  WidgetSpec[] │   NOT html / css / js
        └───────────────┘         └──────┬────────┘
                                          │ validate (zod ↔ registry)
                              ┌───────────▼────────────┐
                              │  pass → render          │
                              │  fail → ground-or-      │
                              │         fallback widget │
                              └───────────┬─────────────┘
                                          │
                               trusted component registry
                              (React Flow canvas + shadcn widgets)
                                          │
                                   the interface
```

This is the seam that makes Trellis's UI **adaptive *and* safe**: adaptivity comes from the model picking the spec; safety comes from the spec being a closed vocabulary the design system already knows how to render.

## 2. Why this is *real* generative UI (and not chatbot-with-cards)

A chatbot-with-cards picks from a **fixed, hand-authored set of card templates** and fills slots. The UI variety is bounded by what an engineer pre-built; the "generation" is template selection. Trellis differs on four counts:

1. **The composition is generated, not just the content.** The agent decides the *canvas strategy* (`checklist` / `compact_dag` / `swimlane_dag` / `hierarchical_map`), the *grouping* (`by_module` / `by_milestone`), the *emphasis*, and **per node** which widget(s) appear. Two plans of the same size render differently because their *structure* differs — a swimlane plan vs. a checklist — not because a different string was slotted into the same card.
2. **It is generated *per plan and per node*, continuously.** A re-plan, a tier promotion, or a build-time drift **re-emits** the specs and the canvas **re-flows** (§5). The UI is a live function of the work, not a one-time template choice frozen at first render.
3. **It is grounded in real program facts.** A `schema-diff` widget shows the *actual* before/after columns; a `call-graph-impact` widget shows the *real* blast radius from the analysis service. The generation is constrained by truth, not free-associated prose. (See [`granularity-layouts.md`](./granularity-layouts.md) §4.)
4. **The output is operable software, not a reply.** Per the program thesis, *"the agent's output is software, not an answer."* The generated surface has Run / Dispatch / Delegate affordances wired to the orchestration engine — you don't *read* it, you *operate* it.

So the model's creative latitude is real (it composes the interface), but it is exercised **through a validated vocabulary**, which is exactly what separates production generative UI from "let the LLM emit HTML" (unsafe) and from "fill these three card templates" (not generative).

## 3. The two axes of adaptation

Trellis adapts on two orthogonal axes; both are produced by agents, both validated, both citing this doc.

| Axis | Driven by | Produces | Renders as |
|------|-----------|----------|------------|
| **A — Granularity → canvas** | detected `granularity` (G1–G4) | `LayoutSpec.canvas` + `direction` + `grouping` + `parallelism_ui` + `delegation_ui` | the whole-plan frame on the [graph canvas](./graph-canvas.md) |
| **B — `change_type` + context → node body** | each node's `change_type` + analysis-extracted context | `WidgetSpec[]` (schema-diff / api-contract / component-preview / call-graph-impact / …) | the node body and [inspector](./node-inspector.md) top section |

The axes are independent: a single plan's **frame** is governed by its tier while each **node body** is governed by its own change-type. A G3 swimlane plan can contain a `migration` node (schema-diff body) next to a `ui_component` node (component-preview body) in different lanes — same frame, different bodies. (Formalized in [`granularity-layouts.md`](./granularity-layouts.md) §7, "the canvas tier governs the *frame*, the node governs its *body*.")

## 4. The generation → validation → render → re-flow loop

Every piece of generated UI passes through the same four-stage loop. This loop is the heart of the philosophy and the thing the assessment criterion rewards.

```
 1. GENERATE     2. VALIDATE          3. RENDER             4. RE-FLOW
 ┌─────────┐     ┌──────────────┐     ┌──────────────┐      ┌──────────────┐
 │ agent    │    │ zod ↔ registry│    │ registry maps │     │ change event  │
 │ emits     │──▶ │ • known canvas│──▶ │ spec → trusted│──▶  │ (re-plan /    │
 │ Layout/   │    │ • known widget│    │   components   │     │  tier flip /  │
 │ Widget    │    │ • valid props │    │ • canvas layout│     │  drift) re-   │
 │ spec       │   │ • grounded ref│    │ • node bodies  │     │  emits specs  │
 └─────────┐ │    └──────┬───────┘    └──────────────┘      └──────┬───────┘
           │ │           │ fail                                     │
           │ │     ┌─────▼──────────┐                               │
           └─┘     │ ground-or-     │                               │
       (retry on   │ fallback:      │                               │
        invalid    │ safe default   │                               │
        JSON,      │ widget, flag   │◀──────────────────────────────┘
        D3-AC3)    │ for backlog    │       loop closes; canvas animates
                   └────────────────┘
```

- **Generate.** Planner emits the `LayoutSpec`; per-node analysis emits `WidgetSpec[]`, populated with grounded data (real symbols, real schema, real contract). Output is tool-forced JSON; invalid JSON is retried (matches `deliverables.md` D3-AC3).
- **Validate.** Each spec is checked against the registry: is the `canvas`/`widget` known? are the props well-formed? are `grounded_refs` present where required? Validation is the trust boundary — **nothing unvalidated reaches the DOM.**
- **Render.** The registry deterministically maps the spec to components: `canvas` → a React Flow layout strategy ([graph-canvas](./graph-canvas.md)); `widget` → a shadcn/Monaco/Shiki-backed component ([node-inspector](./node-inspector.md)); `emphasis` + `default_inspector_tab` → inspector defaults and node badges.
- **Re-flow.** A tier change, re-plan, or drift re-emits specs; the canvas animates to the new layout ([`realtime-ui.md`](./realtime-ui.md)). The loop is closed and continuous, which is what makes the UI *generative over the life of the plan*, not just at birth.

## 5. Principles (the rules every UI doc obeys)

These are normative. The [graph canvas](./graph-canvas.md) and [node inspector](./node-inspector.md) specs are concrete instantiations of them.

1. **Never-raw-HTML.** Agents emit specs, never markup/CSS/JS. The render path has no `dangerouslySetInnerHTML`, no string-to-DOM. The closed widget vocabulary *is* the safety model. (Anchors `granularity-layouts.md` §1, `widget-generation.md`.)
2. **Ground-or-fallback.** Any spec referencing program facts must carry `grounded_refs` (real `file#symbol`). A widget that cannot be grounded **falls back** to a safe default (markdown/`logic` widget) and is flagged for the registry/grounding backlog — it is **never** rendered as a confident-looking fabrication. (Anchors `scope.md` §7, `granularity-layouts.md` §5.3 / §7.)
3. **Deterministic-from-spec.** Given the same validated spec, the render is identical and stateless — no model in the render path. Generation is the only nondeterministic step; everything downstream is a pure function of the spec. This makes the UI testable (visual-regression per tier × change-type) and reproducible from any historical `revision`.
4. **Progressive disclosure.** Density scales with granularity and intent: G1 collapses analysis to chips and opens to the diff; G4 hides node detail behind semantic zoom until you descend. The interface shows the *least* that is faithful, and reveals more on demand. (Anchors `granularity-layouts.md` §6.)
5. **Honesty in the UI.** Trust is a first-class rendered property, not a footnote:
   - **Independence is shown with evidence.** A branch marked independent renders *why* (its touch-set / `plan_edges.evidence`); **false-independence** (two "independent" branches sharing a file, mutated symbol, changed signature, or schema/config key) shows an inline **⚠** with the conflicting symbol cited. (Anchors `deliverables.md` D4-AC3/AC4, `scope.md` §7.)
   - **Confidence is surfaced.** `plan_nodes.confidence` and per-claim `confidence` (from `node_annotations`) are rendered, not hidden.
   - **Low-confidence is labeled.** Any claim that cannot cite a real symbol/file is visibly marked `low-confidence` rather than presented as fact. (Anchors `deliverables.md` D5-AC2.)
   - **The DAG is a *ratified hypothesis*, not a guarantee** — and the UI says so; independence claims are user-correctable (ratify / add / split edge).

## 6. How this maps to the assessment's "use of generative UI" criterion

The criterion rewards a UI that is **generated for the specific work**, not templated once. Trellis earns it on the mechanism itself, and these are the points to demonstrate:

| What the criterion wants | How Trellis delivers it | Evidence in the demo (D17) |
|--------------------------|--------------------------|----------------------------|
| UI *composed* per context, not selected from fixed templates | Agents emit `LayoutSpec` + `WidgetSpec[]`; the *structure* (canvas strategy, grouping, node bodies) is generated | Same product renders four visibly different frames across G1–G4 |
| Adaptivity *with* production safety | Validated specs → trusted registry; never raw HTML; ground-or-fallback | No fabricated widget ever renders; invalid spec degrades gracefully |
| Grounded, not decorative | Widgets show real schema/contract/blast-radius with citations | Click a citation → jump to the cited symbol |
| Live, not frozen | Re-plan / tier flip / drift re-emits specs; canvas re-flows | Add context → canvas animates to a new layout in real time |
| Honest under uncertainty | Independence-with-evidence, confidence surfaced, low-confidence labeled, ⚠ on false independence | Inspector shows confidence + a flagged false-independence case |

The one-sentence pitch for the judges: **"Our agents write a validated UI *specification* — granularity picks the canvas, change-type picks each node's widgets — and a trusted registry renders it; the interface is generated for this exact plan, stays grounded in the real codebase, re-flows as the plan changes, and never trusts the model with raw markup."**

## 7. Relationship to the other UI docs

This document is the **conceptual anchor**; the others are instantiations:

- [`granularity-layouts.md`](./granularity-layouts.md) — the two axes formalized: `LayoutSpec` (axis A) and the change-type→widget map (axis B). *Read it first for the spec shapes; this doc for the why.*
- [`graph-canvas.md`](./graph-canvas.md) — axis A made concrete: how `LayoutSpec.canvas` becomes a React Flow layout, and how honesty principles render on edges/branches.
- [`node-inspector.md`](./node-inspector.md) — axis B made concrete: how `WidgetSpec` + the five annotation sections render, with citations, confidence, and per-claim feedback.
- [`widget-generation.md`](./widget-generation.md) — the registry, the zod validators, and the four MVP widgets.
- [`realtime-ui.md`](./realtime-ui.md) — the re-flow stage of the loop under live collaboration.

---

## To-do list

- [ ] Ratify this doc as the single cited source for the generative-UI stance across `03-generative-ui/*`.
- [ ] Define the **trust boundary** invariant in code: a render-path lint/CI check that forbids `dangerouslySetInnerHTML` and string-to-DOM in the canvas/widget packages (never-raw-HTML).
- [ ] Specify the **ground-or-fallback** contract shared by `LayoutSpec` and `WidgetSpec` validators (required `grounded_refs`, fallback target, backlog flag) so both axes degrade identically.
- [ ] Add a **deterministic-from-spec** guarantee test: same validated spec → byte-identical render snapshot (feeds visual-regression in `granularity-layouts.md`).
- [ ] Specify how **confidence** and **low-confidence** labels are surfaced consistently (node badge, inspector chip, claim row) — single shared component.
- [ ] Specify the standard **independence-with-evidence** and **false-independence ⚠** rendering used by both canvas and inspector (single source of truth from `plan_edges.evidence`).
- [ ] Author the **judge-facing walkthrough** mapping each row of §6 to a concrete moment in the D17 demo script.
- [ ] Cross-link checklist: ensure `graph-canvas.md`, `node-inspector.md`, `widget-generation.md`, and `realtime-ui.md` each cite §5 principles by number.

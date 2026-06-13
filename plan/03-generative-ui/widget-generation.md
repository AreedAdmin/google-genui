# Generative Widgets — Per-Node WidgetSpec Generation & Rendering

> Status: **Canonical.** Specifies how an agent produces a validated `WidgetSpec` and how the client renders it from a **trusted component registry** — never raw model HTML — for the four MVP change-type widgets and the phase-2 widgets.
>
> **Amended by [mandated-integrations.md](../01-architecture/mandated-integrations.md)** — WidgetSpecs may be rendered via **CopilotKit generative UI** (`useCopilotAction` render / `useCoAgentStateRender`) against the same trusted component registry — never raw model HTML. See §6, §4.

This is the **second axis** of Trellis's two-axis generative UI: where [`granularity-layouts.md`](./granularity-layouts.md) governs the *canvas* (`Layout = f(granularity × change_type × context)`), this doc governs the *node body* — the widget(s) rendered inside a node and its inspector. It is the headline of the generative-UI assessment: **the agents compose each node's content per-plan from validated specs, adaptive yet production-safe.** Read [`granularity-layouts.md`](./granularity-layouts.md) §4–5 first; this builds on the `change_type → widget` table and the validation-against-registry gate without re-deriving them.

---

## 1. The core invariant (read this first)

> **The model never emits markup or code that runs. It emits data.** A `WidgetSpec` is `{ widget: <registry-key>, props: <json> }`. The client looks the key up in a compiled-in **component registry**, validates `props` with that widget's **zod schema**, and renders the corresponding React component. Unknown key or invalid props ⇒ a **safe fallback** widget. There is no `dangerouslySetInnerHTML` path anywhere in the render chain.

This buys the *adaptivity* of generative UI (the agent decides which widget and populates it with real, work-specific content) with the *safety and consistency* of a design system (every pixel comes from a reviewed, accessible component in [`component-library.md`](./component-library.md)).

```
 Analysis agent (Sonnet 4.6)                      Client (Next.js)
 ┌────────────────────────┐    persisted to       ┌──────────────────────────────┐
 │ change_type + grounded │   node_annotations    │ registry.get(spec.widget)     │
 │ context (real symbols, │──▶ .widget_specs ──▶  │   ?  → schema.safeParse(props)│
 │ schema, contract)      │      (jsonb)          │       ?  → <Widget {...props}>│
 │  → WidgetSpec[]        │                       │       ✗  → <FallbackWidget>   │
 │  validated server-side │                       │   ✗  → <FallbackWidget>       │
 └────────────────────────┘                       └──────────────────────────────┘
        zod (TS) gate                                   zod (TS) gate (again)
```

Validation runs **twice** (defense in depth): server-side in the worker before the spec is written to `node_annotations.widget_specs` (a failing widget is dropped + logged, the rest persist), and client-side at render (a registry/schema mismatch — e.g. an older client, a newer spec — degrades gracefully instead of crashing the canvas). See [data-model `node_annotations.widget_specs`](../01-architecture/data-model.md).

---

## 2. The `WidgetSpec` schema

A node's `node_annotations.widget_specs` is a **`WidgetSpec[]`** (ordered; first is primary, rest are supplementary). Shared envelope:

```jsonc
// WidgetSpec  (one element of node_annotations.widget_specs)
{
  "widget": "schema_diff",          // registry key — MUST be a known widget
  "version": 1,                     // widget schema version the agent targeted (see §10)
  "props": { /* widget-specific, validated by that widget's zod schema */ },
  "grounding": {                    // provenance — REQUIRED, drives the "grounded" UI affordance
    "refs": ["src/db/schema.ts#users", "migrations/0007_add_oauth.sql"],
    "source": "analysis_service",   // analysis_service | repo_index | model_inferred
    "confidence": 0.86              // 0..1; < 0.5 renders a "low-confidence" banner on the widget
  },
  "fallback_text": "OAuth accounts table: adds provider, provider_account_id"
  // plain-text summary used if the widget itself cannot render (never lost information)
}
```

```ts
// packages/shared/src/widgets/spec.ts  (zod — the envelope)
export const Grounding = z.object({
  refs: z.array(z.string()).default([]),
  source: z.enum(["analysis_service", "repo_index", "model_inferred"]),
  confidence: z.number().min(0).max(1),
});

export const WidgetSpec = z.object({
  widget: WidgetKey,                          // z.enum of registry keys (§4)
  version: z.number().int().positive().default(1),
  props: z.unknown(),                          // refined per-widget by the registry (§3)
  grounding: Grounding,
  fallback_text: z.string().max(400),
});
export type WidgetSpec = z.infer<typeof WidgetSpec>;
```

`props` is `unknown` in the envelope and **narrowed by the registry entry** for `widget` — so the envelope parse and the per-widget parse compose (§3).

---

## 3. The component registry contract

The registry is the single source of truth binding a **key** → **zod props schema** → **React component** → **safe fallback** → **fixtures**. It is *compiled into the client* (a TS object), so the set of renderable widgets is closed and reviewable.

```ts
// packages/shared/src/widgets/registry.ts
export interface RegistryEntry<P> {
  key: WidgetKey;
  version: number;                  // current schema version
  propsSchema: z.ZodType<P>;        // validates spec.props
  Component: React.ComponentType<P>;
  Skeleton: React.ComponentType;    // loading state (streamed/late props)
  fixtures: P[];                    // golden props for visual-regression + Storybook
  a11yLabel: (p: P) => string;      // ARIA label generator
  maxPropsBytes: number;            // hard cap, anti-DoS (e.g. 64 KiB)
}

export const REGISTRY: Record<WidgetKey, RegistryEntry<any>> = {
  schema_diff:       schemaDiffEntry,
  api_contract:      apiContractEntry,
  component_preview: componentPreviewEntry,
  call_graph_impact: callGraphImpactEntry,
  // phase 2:
  key_diff:          keyDiffEntry,
  test_linkage:      testLinkageEntry,
  resource_diagram:  resourceDiagramEntry,
  markdown:          markdownEntry,           // sanitized renderer (§9)
  checklist:         checklistEntry,
};
```

**Render algorithm (client):**

```ts
function renderWidget(spec: unknown) {
  const env = WidgetSpec.safeParse(spec);
  if (!env.success) return <FallbackWidget reason="bad_envelope" raw={spec} />;
  const entry = REGISTRY[env.data.widget];                  // closed set — key must exist
  if (!entry) return <FallbackWidget reason="unknown_widget" spec={env.data} />;
  if (byteLen(env.data.props) > entry.maxPropsBytes)
    return <FallbackWidget reason="oversize" spec={env.data} />;
  const p = entry.propsSchema.safeParse(env.data.props);
  if (!p.success) return <FallbackWidget reason="bad_props" spec={env.data} issues={p.error} />;
  const W = entry.Component;
  return (
    <WidgetFrame grounding={env.data.grounding} aria-label={entry.a11yLabel(p.data)}>
      <W {...p.data} />
    </WidgetFrame>
  );
}
```

`WidgetFrame` is the shared chrome from [`component-library.md`](./component-library.md): it draws the grounding affordance (a "grounded · N refs · confidence" chip that expands to the cited symbols), the low-confidence banner when `confidence < 0.5`, and the widget's title/actions. **No widget renders without a frame**, so the grounding signal is structurally guaranteed (honesty constraint from [scope §7](../00-overview/scope.md)).

**`FallbackWidget`** renders `spec.fallback_text` as sanitized plain text inside a muted panel with a small "couldn't render `<widget>`" note and a "report" action that files to the registry backlog (§10). The plan is never broken by a bad spec; the worst case is a node showing its text summary.

---

## 4. The four MVP widgets

These map 1:1 to the headline rows of the [`granularity-layouts.md` §4 table](./granularity-layouts.md). Props schemas are authoritative; ASCII mockups show the rendered shape.

### 4.1 `schema_diff` — for `change_type: migration`

Before/after of a DB schema (table/columns/indexes/constraints), plus its **ordering** relative to other migration nodes (grounded from the engine, [dependency-inference-engine.md](../02-agent-system/dependency-inference-engine.md)).

```ts
const Column = z.object({
  name: z.string(), type: z.string(),
  nullable: z.boolean().default(true),
  default: z.string().nullable().default(null),
  pk: z.boolean().default(false), fk: z.string().nullable().default(null),
});
const TableShape = z.object({
  table: z.string(),
  columns: z.array(Column),
  indexes: z.array(z.object({ name: z.string(), cols: z.array(z.string()), unique: z.boolean() })).default([]),
});
export const SchemaDiffProps = z.object({
  kind: z.literal("table"),                       // future: enum table | type | enum
  before: TableShape.nullable(),                  // null = newly created
  after:  TableShape.nullable(),                  // null = dropped
  ordering: z.object({                            // migration ordering vs siblings
    must_run_after: z.array(z.string()).default([]),   // node ids/titles
    reversible: z.boolean().default(true),
  }).optional(),
});
```

```
┌ schema-diff · oauth_accounts ───────────── grounded · 2 refs · 0.86 ▾ ┐
│ Column           Before            After                      Δ        │
│ ──────────────── ───────────────── ────────────────────────  ───────── │
│ id               —                 uuid pk                    + added   │
│ user_id          —                 uuid fk→users.id          + added   │
│ provider         —                 text not null             + added   │
│ provider_acct_id —                 text not null             + added   │
│ created_at       —                 timestamptz default now() + added   │
│ index uq_provider_acct (provider, provider_acct_id) unique   + added   │
│ ────────────────────────────────────────────────────────────────────  │
│ ⓘ must run after  [migrate ledger]   · reversible ✓                    │
└───────────────────────────────────────────────────────────────────────┘
```

### 4.2 `api_contract` — for `change_type: api_contract`

Endpoint + request/response shapes + status codes + **breaking-change flags** (the contract table from [scope §4](../00-overview/scope.md)).

```ts
const FieldShape = z.object({
  name: z.string(), type: z.string(),
  required: z.boolean().default(false),
  note: z.string().optional(),
  change: z.enum(["added", "removed", "changed", "unchanged"]).default("unchanged"),
});
export const ApiContractProps = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),                               // "/auth/oauth/:provider"
  request: z.object({
    params: z.array(FieldShape).default([]),
    query:  z.array(FieldShape).default([]),
    body:   z.array(FieldShape).default([]),
  }),
  responses: z.array(z.object({
    status: z.number().int(),
    body: z.array(FieldShape).default([]),
    description: z.string().optional(),
  })),
  breaking: z.array(z.object({                    // explicit, grounded breaking changes
    what: z.string(), why: z.string(),
    severity: z.enum(["low", "medium", "high"]),
  })).default([]),
});
```

```
┌ api-contract · POST /auth/oauth/:provider ──── grounded · 3 refs · 0.91 ▾ ┐
│ Request                                                                    │
│  param  provider   string  required   path                                │
│  body   code       string  required   (added)                             │
│  body   redirect   string  optional                                       │
│ Responses                                                                  │
│  200    { session: Session, user: User }                                   │
│  401    { error: "invalid_grant" }                                         │
│  409    { error: "account_linked" }            (added)                     │
│ ⚠ Breaking (1)                                                             │
│  · login() return type Session → Promise<Session>   [high]                 │
│    callers in src/auth/index.ts must await         → edges to 2 nodes      │
└───────────────────────────────────────────────────────────────────────────┘
```

### 4.3 `component_preview` — for `change_type: ui_component`

A **sandboxed** rendered preview (or skeleton) + prop table + the component's states. The preview is the one widget that renders user-facing UI, so it runs in an **isolated iframe sandbox** (§9).

```ts
export const ComponentPreviewProps = z.object({
  name: z.string(),                               // "LoginButton"
  framework: z.enum(["react"]).default("react"),
  props: z.array(z.object({
    name: z.string(), type: z.string(),
    required: z.boolean().default(false),
    default: z.string().nullable().default(null),
  })).default([]),
  states: z.array(z.object({                      // named render states
    label: z.string(),                            // "default" | "loading" | "error" | "disabled"
    propsJson: z.string(),                        // JSON of props for this state (validated string)
  })).default([]),
  preview: z.object({
    mode: z.enum(["sandbox", "skeleton", "static_image"]),
    // sandbox: a self-contained, dependency-free snippet rendered in the iframe (§9)
    // skeleton: structural placeholder only (no eval) — default until a real preview exists
    snippet_ref: z.string().nullable().default(null),  // storage ref, not inline code
  }),
});
```

```
┌ component-preview · LoginButton ───────────── grounded · 1 ref · 0.74 ▾ ┐
│ ┌───────── sandbox (iframe) ─────────┐   States: ● default ○ loading ○ error│
│ │   [  Continue with Google  ]       │   Props                              │
│ │   [  Continue with GitHub  ]       │    provider  "google"|"github"  req  │
│ └────────────────────────────────────┘    loading   boolean        false   │
│                                            onClick   () => void      req    │
│ ⚠ low-confidence preview · skeleton until build produces the real component │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.4 `call_graph_impact` — for `change_type: logic | refactor`

The changed symbol, its callers, and the **blast radius** straight from the engine. Props are **populated from the analysis service's call-graph output** — not invented (grounding §8).

```ts
const ImpactNode = z.object({
  symbol: z.string(),                             // "src/auth/index.ts#login"
  file: z.string(),
  relation: z.enum(["root", "caller", "callee", "transitive"]),
  depth: z.number().int().min(0),
  risk: z.enum(["none", "signature", "behavior"]).default("none"),
});
export const CallGraphImpactProps = z.object({
  root: z.string(),                               // the changed symbol
  affected: z.array(ImpactNode),
  blast_radius: z.object({
    files: z.number().int(), symbols: z.number().int(),
    crosses_branches: z.boolean(),                // ties to false-independence detection
  }),
  truncated: z.boolean().default(false),          // graph capped for render (see truncation §6)
});
```

```
┌ call-graph-impact · login() ────────────────── grounded · 5 refs · 0.88 ▾ ┐
│            ● login (root, sig△)                                            │
│           ╱        ╲                                                       │
│   ▸ handleOAuth   ▸ handleSession        depth 1 · callers (2)             │
│        │               │                                                   │
│   ▸ authRouter    ▸ refreshToken         depth 2 · transitive (2)          │
│ Blast radius: 4 files · 6 symbols · ⚠ crosses branch B (shared login)     │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 5. The phase-2 widgets

Same envelope, same gate; lighter rollout. Sketched here so the registry and selection logic are complete.

| Key | `change_type` | Props (essentials) | Shape |
|-----|---------------|--------------------|-------|
| `key_diff` | `config` | `{ keys: [{ key, before, after, scope: env\|di\|config, consumers: string[] }] }` | a 2-column key/value diff + "who reads this key" list |
| `test_linkage` | `bugfix`, `test` | `{ failing: {name, file, repro}, fix_ref, expectation, status: red\|green\|unknown }` | failing-test → fix → expected-pass strip |
| `resource_diagram` | `infra` | `{ resources: [{ name, kind: container\|queue\|bucket\|fn, change: add\|modify\|remove }], edges: [{from,to,label}] }` | small boxes-and-arrows resource graph (registry shapes only — no free SVG) |
| `markdown` | `docs`, fallback | `{ md: string }` | **sanitized** markdown (§9); the universal soft fallback |
| `checklist` | `test`, `docs` | `{ items: [{ text, checked }] }` | a static checklist |

```
key-diff · providers config            test-linkage · #1423 race on login
┌──────────────────────────────────┐   ┌────────────────────────────────────┐
│ OAUTH_GOOGLE_ID   —    ▸ env.ts   │   │ ✗ login spec: "rejects stale token" │
│ OAUTH_GOOGLE_SEC  —    ▸ env.ts   │   │   repro: two concurrent refreshes   │
│ SESSION_TTL       3600  → 7200    │   │ → fix: lock:file login.ts           │
│   read by: session.ts, mw/auth.ts │   │ ✓ expected: spec goes green         │
└──────────────────────────────────┘   └────────────────────────────────────┘
```

---

## 6. Widget selection logic (`change_type` + context → widget)

The analysis agent does not free-choose. Selection is a **deterministic primary mapping** ([`granularity-layouts.md` §4](./granularity-layouts.md)) plus **context-driven supplementary widgets**:

```
selectWidgets(node, analysis) → WidgetSpec[]:
  primary = PRIMARY_MAP[node.change_type]              # the §4 table — fixed
  specs   = [ build(primary, analysis) ]

  # supplementary widgets when grounded context warrants them:
  if analysis.touch_set.signatures_changed and primary != "api_contract":
      specs.push build("call_graph_impact", analysis)  # show blast radius of the sig change
  if analysis.touch_set.schema_keys and primary != "schema_diff":
      specs.push build("schema_diff", analysis)
  if node.change_type in {bugfix} and analysis.failing_test:
      specs.push build("test_linkage", analysis)

  return specs.filter(s => s.grounding.confidence >= MIN_EMIT or s.widget == primary)
              .slice(0, MAX_WIDGETS_PER_NODE)           # cap (e.g. 3) for density
```

Rules:
- **Primary is mandatory and fixed by `change_type`** — predictable, testable, matches the canon table. Unknown `change_type` ⇒ `markdown` (the [layouts §7](./granularity-layouts.md) "unknown change-type → markdown" rule), flagged for the registry backlog.
- **Supplementary widgets are added only when grounded evidence exists** (a real signature change, real schema keys, a real failing test). No evidence ⇒ no widget. This prevents speculative/empty widgets.
- **Truncation**: large props (e.g. a 200-node call graph) are capped at `build` time with `truncated: true`; the widget shows "+N more" and links to the full graph in the inspector. Caps keep render fast (see [`realtime-ui.md`](./realtime-ui.md) performance).
- **Caps**: `MAX_WIDGETS_PER_NODE` (default 3) and `entry.maxPropsBytes` bound the worst case.

The chosen primary also sets the node's `default_inspector_tab` via the [`LayoutSpec`](./granularity-layouts.md) `emphasis`/`default_inspector_tab` fields — so the inspector ([`node-inspector.md`](./node-inspector.md)) opens to the right widget.

---

## 7. How an agent produces a WidgetSpec (the generation flow)

1. **Analysis agent** ([analysis-annotation-agent](../02-agent-system/analysis-annotation-agent.md), Sonnet 4.6) finishes the five-section annotation for a node and has the node's **resolved touch-set** (real files/symbols/schema/signatures from the analysis service) and engine evidence in context.
2. It runs `selectWidgets` (§6) and, for each chosen widget, **fills props from the resolved context** via a tool call — `build_widget(widget, node_id)` returns a draft props object assembled from `touch_set.resolved`, the symbol/call graph, the contract diff, etc. The agent does *not* type schema columns from memory; it transcribes the tool result.
3. Each draft is wrapped in the `WidgetSpec` envelope with `grounding.refs` = the cited symbols/files and `grounding.source` = where the data came from.
4. **Server-side validation gate** (worker, zod): `WidgetSpec.parse` then `REGISTRY[widget].propsSchema.parse`. Pass ⇒ kept; fail ⇒ dropped, an `events` row logged (`widget_validation_failed`, with the zod issues), and the node still ships its other widgets + text. The widget enters the **registry-backlog** signal if the same shape fails repeatedly.
5. Validated array is written to `node_annotations.widget_specs` (per revision). Re-plan/drift ([`replan-and-drift`](../02-agent-system/replan-and-drift.md)) regenerates specs for changed nodes only; the client re-renders via the streaming path in [`realtime-ui.md`](./realtime-ui.md) (skeleton → filled).

---

## 8. Grounding (props come from real symbols, not invention)

Grounding is the trust spine ([scope §7](../00-overview/scope.md), pillar P2). Enforced structurally:

- **Source of props is the analysis service / repo index, not the model's prose.** `build_widget` reads `touch_set.resolved`, the symbol graph, the call graph, and the contract differ — all keyed by `{project, commit}`. The model's job is selection + transcription + summary, not fabrication.
- **Every spec carries `grounding.refs`** (cited symbols/files) and a `confidence`. The `WidgetFrame` (§3) renders the chip; `confidence < 0.5` adds a visible **low-confidence banner**. A widget with `refs: []` and `source: model_inferred` is allowed only for `markdown` fallbacks and is always labeled.
- **Reference resolution**: each `ref` is a clickable token that opens the file/symbol in the inspector's "notable symbols" view, so a reviewer can verify the claim. Dead refs (symbol no longer exists post-drift) are flagged, not silently shown.
- **Anti-hallucination test**: schema-fuzzing (§11) + a grounding check that every non-fallback widget's `refs` resolve in the current `repo_index`. Specs whose refs don't resolve fail the gate.

---

## 9. Security model

| Vector | Mitigation |
|--------|-----------|
| **Arbitrary HTML/JS injection** | The model emits **data only**; there is no HTML/JSX path. No `dangerouslySetInnerHTML`, no `eval`, no `new Function` over model output anywhere in the render chain. |
| **`markdown` widget** | Rendered through a **sanitizing** pipeline (`react-markdown` + `rehype-sanitize` with an allowlist; no raw HTML, no `<script>`, no `javascript:` URLs, no auto-linkified credentials). |
| **`component_preview` sandbox** | The only widget that renders user UI runs in a **sandboxed `<iframe sandbox="allow-scripts">`** (no `allow-same-origin`) on a **separate origin**, with a strict CSP (`default-src 'none'; script-src 'self'`), no network, no access to the parent DOM/cookies/storage. The snippet is a **dependency-free, self-contained** render fetched from Storage (`snippet_ref`), size-capped, and time-boxed; on timeout/error it degrades to `skeleton`. Until a build produces a real component, `mode: skeleton` (no execution at all) is the default. |
| **Prop DoS (huge graphs/strings)** | `entry.maxPropsBytes` hard cap + per-array length caps in each schema + `truncated` flag; oversize ⇒ fallback. |
| **Spec spoofing across tenants** | Specs live in `node_annotations` under RLS ([data-model §4](../01-architecture/data-model.md)); the client only ever renders specs for nodes the caller can read. The registry is client-side and tenant-agnostic. |
| **Stale/incompatible specs** | Version field (§10) + double validation ⇒ an old client downgrades a too-new widget to fallback rather than mis-rendering. |

---

## 10. Versioning the registry

- Each `RegistryEntry` carries a `version`; each `WidgetSpec` carries the `version` the agent targeted. The registry keeps **additive, backward-compatible** prop evolution by default (new optional fields). A breaking change bumps `version` and the registry keeps a **migrator** `vN → vN+1` (or, if absent, renders fallback for the old version with a "widget updated, re-plan to refresh" note).
- **Adding a widget** = a reviewed PR adding a `RegistryEntry` (key + zod schema + component + skeleton + fixtures + a11yLabel) and extending the `WidgetKey` enum. Because the set is closed and compiled-in, every renderable widget is code-reviewed and accessible by construction.
- **Registry backlog**: repeated fallbacks for an unknown `change_type`/shape, repeated `bad_props` for one widget, and user "report" actions (§3) all feed a backlog signal so we know which widget to add or which schema to fix.
- A `registry_manifest` (key → version) is exposed to the analysis agent's prompt so it targets versions the deployed client supports.

---

## 11. Testing

| Layer | What | How |
|-------|------|-----|
| **Schema unit** | each widget's zod schema accepts golden fixtures, rejects malformed props | `fixtures` from the registry entry; table-driven |
| **Schema fuzzing** | the gate never crashes and always yields a renderable result (valid widget *or* fallback) on arbitrary/adversarial `props` | property-based (`fast-check`) generating random/oversize/wrong-type props; assert `renderWidget` returns without throw and chooses fallback on invalid input |
| **Per-widget visual regression** | each widget renders pixel-stable across its fixtures and states (default/loading/error/low-confidence) | Storybook stories (one per fixture) + snapshot/visual-diff (Playwright/Chromatic); covers light & dark ([`component-library.md`](./component-library.md)) |
| **Grounding integrity** | every non-fallback widget's `grounding.refs` resolve against a fixture `repo_index` | analysis-service stub + assertion in the gate test |
| **Sandbox isolation** | `component_preview` iframe cannot reach parent DOM/network/cookies | a hostile snippet fixture asserts no escape (CSP + sandbox attributes enforced) |
| **Selection logic** | `selectWidgets` picks the right primary + only-grounded supplementaries; respects caps | unit tests over representative `(change_type, analysis)` cases |
| **End-to-end** | a known plan fixture produces expected `widget_specs`; the canvas renders all four MVP widgets | one fixture per MVP widget, reused from the [layouts demo fixtures](./granularity-layouts.md) |

---

## To-do list

### Schema & registry
- [ ] `WidgetSpec` envelope + `Grounding` zod schemas in `packages/shared`.
- [ ] `WidgetKey` enum + `REGISTRY` contract (`RegistryEntry`: schema, component, skeleton, fixtures, a11yLabel, maxPropsBytes).
- [ ] `renderWidget` client algorithm + `WidgetFrame` (grounding chip, low-confidence banner) + `FallbackWidget`.
- [ ] Double-validation gate (server worker + client) with `widget_validation_failed` event logging.

### The four MVP widgets
- [ ] `schema_diff` (props schema + component + skeleton + fixtures + Storybook).
- [ ] `api_contract` (incl. breaking-change list wired to edges).
- [ ] `component_preview` (skeleton mode first; sandboxed-iframe mode behind §9 controls).
- [ ] `call_graph_impact` (props fed from analysis-service call graph; truncation).

### Phase-2 widgets
- [ ] `key_diff`, `test_linkage`, `resource_diagram`, `markdown` (sanitized), `checklist`.

### Generation & grounding
- [ ] `build_widget(widget, node_id)` tool that assembles props from `touch_set.resolved` + symbol/call graph (no model-typed data).
- [ ] `selectWidgets` (primary mapping + grounded supplementaries + caps + truncation).
- [ ] Grounding-ref resolution against `repo_index`; dead-ref flagging.

### Security, versioning, testing
- [ ] Markdown sanitizer (rehype-sanitize allowlist) + preview iframe sandbox/CSP/timeout.
- [ ] `maxPropsBytes` + per-array caps; oversize → fallback.
- [ ] Registry versioning + `registry_manifest` exposed to the agent; migrators for breaking bumps.
- [ ] Schema-fuzz suite (`fast-check`), per-widget visual regression, sandbox-isolation test, grounding-integrity test.

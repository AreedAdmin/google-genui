# Screenshot capture checklist

The README references the images below. Filenames are wired up already — **capture each one and
drop the PNG into `assets/`** (same folder as `architecture.png` / `schema.png`) and it renders
with no further edits.

The flagship storyline is the demo run-of-show in
[`plan/05-implementation/demo-script.md`](../plan/05-implementation/demo-script.md) — *"Add Sign in
with Google + GitHub"* on the `acme-app` demo repo. Capture against that plan so the screenshots
match the README captions. The four granularity shots use the three seeded vignette plans
(`g1-tighten-validation`, `g3-extract-billing`, `g4-analytics-platform`) plus the G2 OAuth plan.

**Capture hygiene**
- Browser at **1440×900**, light or dark — but be consistent across all frames.
- Hide personal data (real repo names, emails). Use the demo org.
- Trim to the relevant region; don't ship full-desktop screenshots.
- **Optimize before committing** (`pngquant`/`oxipng` or TinyPNG). Aim < 400 KB each;
  `architecture.png` at 2.1 MB is the cautionary tale.
- A short autoplay **GIF** is welcome for the hero, `flow-5-operate`, and `flow-4-iterate`
  (keep GIFs < 5 MB; commit as `.gif` and update the `<img src>` if you do).

---

## Tier 1 — essential (the hero + the 6-step flow)

| File | What to capture | Source |
|------|-----------------|--------|
| `assets/hero-canvas.png` | The G2 OAuth plan open on the canvas — 6 nodes, 2 tinted lanes, inspector open on one node. The single "money shot". GIF of Describe→Plan→Inspect is even better. | Acts 2–3 |
| `assets/flow-1-describe.png` | Claude Code terminal showing `/trellis add "Sign in with Google and GitHub"…` and the returned plan summary + canvas link. | Act 1 |
| `assets/flow-2-plan.png` | Full canvas: the compact left-to-right DAG, 6 nodes, the two independent lanes clearly tinted. | Act 2 |
| `assets/flow-3-inspect.png` | Inspector open on the **migration** node — schema-diff widget on top, the five grounded sections, **a citation hovered so it links into a real `file#symbol`**. This is the grounded-analysis proof shot. | Act 3 |
| `assets/flow-4-iterate.png` | A weak assumption being thumbs-downed and greying out (and/or the graph re-planning after an edit). | Acts 3 & 7 |
| `assets/flow-5-operate.png` | Two branches building in parallel with **live diffs streaming**, converging on the integration node / test gate. GIF preferred. | Acts 4–5 |
| `assets/flow-6-delegate.png` | The subtree-delegation UI — handing a branch to a second user (Bob) who runs it from their session. | Act 6 |

## Tier 2 — high value (the granularity strip)

Square-ish crops, ~600px wide each; they render at 200px in a 4-col table.

| File | What to capture | Source |
|------|-----------------|--------|
| `assets/granularity-g1.png` | **G1 micro** — a single-node change collapsed to a diff. | `g1-tighten-validation` |
| `assets/granularity-g2.png` | **G2 meso** — the compact OAuth DAG (can reuse the `flow-2` framing, zoomed out). | OAuth plan |
| `assets/granularity-g3.png` | **G3 macro** — a multi-branch plan. | `g3-extract-billing` |
| `assets/granularity-g4.png` | **G4 mega** — a zoomable migration map. | `g4-analytics-platform` |

## Tier 3 — nice to have (widget gallery)

Tight crops of just the widget card, ~720px wide (render at 240px).

| File | What to capture | Source |
|------|-----------------|--------|
| `assets/widget-schemadiff.png` | The **SchemaDiff** widget (before/after `oauth_accounts` columns). | Act 3 · migration node |
| `assets/widget-apicontract.png` | The **ApiContract** widget (method, request/response, breaking-change flag). | Act 3 · `/auth/oauth/:provider` node |
| `assets/widget-callgraph.png` | The **CallGraphImpact** widget (existing callers of `createSession`). | Act 3 · `createSession` node |

---

## Already captured (no action needed)
- `assets/architecture.png` — regenerate from [`docs/architecture.html`](./architecture.html) (open + screenshot).
- `assets/schema.png` — Postgres ERD.

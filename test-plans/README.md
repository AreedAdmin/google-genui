# test-plans

Captured `PlanGraph` JSON from **live** plan runs (real Opus planner + analysis agents against
the seed `Demo Project`), used to verify the generative-UI deepening work in
[`plan/03-generative-ui/generative-ui-deepening.md`](../plan/03-generative-ui/generative-ui-deepening.md).

Each file is exactly what `GET /v1/plans/:id` returns (plan + nodes + edges + branches +
annotations) — the same shape the canvas renders and `apps/web/lib/fixtures.ts` mirrors.

| File | Prompt | Proves |
|------|--------|--------|
| `01-observability-multiwidget.json` | "Add observability to the billing service…" | **Change 2** — every node carries 1–3 widgets; live model emitted `checklist` + `markdown` (previously fell back). canvas `compact_dag`, 5 nodes. |
| `02-notifications-swimlane.json` | "Add a notifications feature as three independent parallel workstreams…" | **Change 1** — model chose `swimlane_dag` (grouping `by_module`) where the old node-count clamp would have forced `compact_dag`. 6 nodes, all multi-widget. |
| `03-release-report-composed.json` | "Create a single release-readiness report for the billing service…" | **Change 3** — model emitted the `composed` widget, assembling a body from primitives (`text`, `stat`×3, `table`, `timeline`). canvas `checklist`, 1 node. |

## Regenerating

The stack must be up (see `local-dev-stack` memory / `context.md` §26). Then:

```bash
curl -s -X POST http://localhost:8180/v1/plans \
  -H 'content-type: application/json' \
  -d '{"project_id":"00000000-0000-0000-0000-000000000100","prompt":"<your prompt>"}'
# poll GET /v1/plans/:id until status=ready and annotations are populated, then save the body here.
```

> These are **captured artifacts**, not deterministic fixtures — re-running the same prompt
> produces different (model-generated) output. For deterministic UI fixtures see
> `apps/web/lib/fixtures.ts`.

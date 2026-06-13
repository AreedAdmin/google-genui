# Risks & Mitigations

> Status: **Canonical.** A risk register for Trellis — each risk scored by likelihood and impact, with a concrete mitigation and an owning area — plus the explicit "bet-the-product" shortlist.

## Scoring legend

- **Priority:** **P0** = bet-the-product / blocks ship · **P1** = serious, must be managed · **P2** = watch.
- **Likelihood / Impact:** Low / Med / High.
- **Category:** technical · product · trust · ops · cost.
- Targets and instrumentation referenced are in [`success-metrics.md`](./success-metrics.md); scope guardrails in [`scope.md`](./scope.md) §7.

---

## Risk register

| ID | Risk | Cat. | Likelihood | Impact | Pri | Mitigation | Owner area |
|----|------|------|:----------:|:------:|:---:|------------|-----------|
| **R1** | **False independence → corrupted merges.** Two branches marked `independent` actually conflict; parallel dispatch silently corrupts code. | technical / trust | Med | **High** | **P0** | The whole safety stack: touch-set resolution to *real* symbols, file-overlap + signature + schema/config-key checks, `lock:file:{project}:{path}` guard, conflict detection at the integration node, and **FIR ≤ 1%** gated in CI. Recall favored over precision (a missed edge is worse than a spurious one). Independence shown as a *ratifiable hypothesis with evidence*, never a guarantee. | [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md) |
| **R2** | **Plan drift.** A build discovers a dependency the plan didn't model; the DAG goes stale and a "safe" branch becomes unsafe. | technical | High | High | **P0** | Live re-derivation (D8): builder-discovered deps re-flow edges/branches into a **new revision** with a UI drift notice; **drift-caught-before-merge ≥ 99%**; integration gate refuses to merge on red. | [`../02-agent-system/replan-and-drift.md`](../02-agent-system/replan-and-drift.md) |
| **R3** | **Analysis hallucination erodes trust.** Ungrounded or wrong risk/assumption claims; one bad citation and users stop believing the whole surface. | trust | Med | **High** | **P0** | Every claim cites a resolvable symbol/file or is labeled `low-confidence`; **grounding ≥ 95%, hallucination ≤ 2%** gated in eval; thumbs-down suppresses patterns (`feedback` loop); confidence signal always visible. | [`../02-agent-system/analysis-annotation-agent.md`](../02-agent-system/analysis-annotation-agent.md) |
| **R4** | **Merge / integration pain.** Even correct independence yields painful reconvergence (lockfiles, formatters, import order) that swamps the speedup. | technical / product | High | Med | **P1** | Integration nodes attempt merge + run the test gate; deterministic post-merge normalizers (format/lint/lockfile) before conflict surfacing; resolution UI for the residue; nothing auto-merges on red tests. | [`../02-agent-system/integration-merge.md`](../02-agent-system/integration-merge.md) |
| **R5** | **Granularity range too wide.** Serving G1 typos *and* G4 migrations dilutes both — heavy DAG ceremony on G1, an unnavigable wall on G4. | product | Med | Med | **P1** | Tier is detected and bounds enforced: G1 collapses to diff-first (no forced DAG), G4 clusters into zoomable super-nodes; the engine *refuses to fake* a DAG for fine-grained work ([`scope.md`](./scope.md) §7). Anchor on **G2 as the sweet spot**; G1/G4 are range proof, not the center. | [`../03-generative-ui/granularity-layouts.md`](../03-generative-ui/granularity-layouts.md) |
| **R6** | **Scope creep in delegation.** Delegation grows toward a labor marketplace / payments / arbitrary task graph — unbounded surface. | product | Med | Med | **P1** | v1 delegation ships as **sharing + portable subtree spec only** (viewer/runner/editor), explicitly *not* a marketplace ([`scope.md`](./scope.md) §5). Portable spec is self-contained (nodes/edges/touch-sets/analysis/base commit) — no open-ended runtime contract. | [`../04-collaboration-delegation/subtree-delegation.md`](../04-collaboration-delegation/subtree-delegation.md) |
| **R7** | **Latency / cost blow-up at G4.** 50–100+ nodes of Opus planning + analysis + builds breach the latency budget and the cost ceiling. | cost / ops | High | Med | **P1** | Clustered (per-super-node, not per-leaf) planning/analysis; prompt caching of the repo-context block (**cache hit ≥ 70%**); Sonnet for high-volume build; hard cost guard via `ratelimit:org:{id}`; per-tier cost caps (≤ $15 planning / ≤ $100 full at G4). | [`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md) |
| **R8** | **Multi-language brittleness.** Touch-set resolution / symbol-graph quality drops outside TS/JS, silently degrading independence inference (→ feeds R1). | technical | High | Med | **P1** | Ship **TS/JS first, Python second**; language is pluggable (a grammar = a language) behind the analysis service; **per-language resolution_confidence** gates how strongly the engine asserts independence — low confidence widens edges (errs toward dependence). | [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md) |
| **R9** | **Sandbox / security of code execution.** Agents execute model-generated code on customer repos; a sandbox escape or secret exfiltration is catastrophic, especially Phase B. | ops / trust | Med | **High** | **P1** (→ **P0** at Phase B) | Builds run in a resource/network-constrained container; per-org isolation; secrets never in the model context; RLS + service-role scoping on every query; ephemeral worktrees torn down after runs. Customer-facing safety bar is a **Phase B gate**, not an MVP afterthought ([`scope.md`](./scope.md) §6). | [`../01-architecture/security-and-auth.md`](../01-architecture/security-and-auth.md) |
| **R10** | **"Both audiences" dilution.** Trying to serve internal dogfood *and* external customers at once splits focus and ships two half-products. | product / ops | Med | Med | **P1** | Phasing, not parallel builds: **Phase A internal** validates the engine on repos we control; **Phase B** adds the hardened customer bar; **Phase C** platformizes. One product, sequenced ([`scope.md`](./scope.md) §6). | [`../05-implementation/milestones-and-phases.md`](../05-implementation/milestones-and-phases.md) |
| **R11** | **Generated UI is unsafe or off-context.** Model emits free-form HTML or a layout that doesn't fit the work → injection risk or a confusing surface. | technical / product | Med | Med | **P1** | Widgets/layouts render only from **validated specs against a component registry** — never raw model HTML; layout = `f(granularity × change_type × context)` validated before render; fallback to a safe default layout on validation failure. | [`../03-generative-ui/widget-generation.md`](../03-generative-ui/widget-generation.md) |
| **R12** | **Concurrent edit / state divergence.** Multiple editors + live re-plan race; optimistic UI and server state diverge. | technical | Med | Med | **P2** | Supabase Realtime as the durable truth + Redis pub/sub for ephemeral signal; optimistic UI with server reconciliation; full `revision` versioning so any state is reconstructable; CRDT deferred unless true co-editing becomes hard ([`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md) §8). | [`../03-generative-ui/realtime-ui.md`](../03-generative-ui/realtime-ui.md) |
| **R13** | **Indexing scale / staleness.** Large repos index slowly or the cached symbol graph goes stale vs the working commit → wrong touch-sets (→ feeds R1). | technical / ops | Med | Med | **P2** | Incremental re-index on new commits; cache keyed by `{project, commit_sha}` with TTL; warm-cache index serve < 2s (D1-AC4); resolution keyed to the plan's `base_commit`. | [`../02-agent-system/dependency-inference-engine.md`](../02-agent-system/dependency-inference-engine.md) |
| **R14** | **Worktree / orchestration resource exhaustion.** Heavy G4 fan-out spawns too many worktrees/containers; host pressure stalls or fails runs. | ops / cost | Med | Med | **P2** | Bounded worker concurrency (BullMQ); dispatch locks + file-overlap guard cap safe concurrency; ephemeral worktrees reaped; back-pressure via the queue; cost/rate guards. | [`../02-agent-system/parallel-orchestration.md`](../02-agent-system/parallel-orchestration.md) |
| **R15** | **Model dependence / drift.** Tuned to Opus 4.8 + Sonnet 4.6; a model change or outage degrades plan/analysis quality. | technical / ops | Low | Med | **P2** | Model-pluggable behind an internal interface; eval harness re-runs on any model swap to detect regression before rollout; schema-forced JSON keeps outputs structurally stable across models. | [`../01-architecture/tech-stack.md`](../01-architecture/tech-stack.md) |

---

## Top-5 "bet-the-product" risks

If any one of these is unsolved, Trellis has no defensible product. They are the focus of every milestone gate.

1. **R1 — False independence → corrupted merges.** The single existential risk. The entire thesis is "parallelism you can trust"; FIR ≤ 1% is the line. *(P0)*
2. **R2 — Plan drift.** A static DAG rots the moment a build reveals a hidden dependency; without live re-derivation, R1 returns through the back door. *(P0)*
3. **R3 — Analysis hallucination.** One confidently wrong citation and users stop trusting the plan, which kills run-through and the north star. *(P0)*
4. **R9 — Sandbox / security of code execution.** Executing model-generated code on customer repos; a single escape ends the customer-facing business. *(P1 now → P0 at Phase B)*
5. **R7 — Latency / cost at G4.** If the top of the granularity range is unaffordable or too slow, the "any granularity" promise collapses to "small changes only," gutting the originality and economic-value claims. *(P1)*

## To-do list

- [ ] Assign a named owner to each P0/P1 risk and put R1–R3 on every milestone gate ([`../05-implementation/milestones-and-phases.md`](../05-implementation/milestones-and-phases.md)).
- [ ] Stand up the FIR eval gate (R1) and the drift-fixture suite (R2) in CI before any parallel-dispatch demo.
- [ ] Define the grounding/hallucination eval thresholds as hard CI gates (R3) per [`success-metrics.md`](./success-metrics.md).
- [ ] Threat-model the build sandbox (R9) and set the Phase-B promotion checklist that flips it to P0.
- [ ] Load-test G4 planning/analysis cost + latency against the budget (R7); confirm the cost guard hard-stops.
- [ ] Document the per-language `resolution_confidence` policy (R8) — how low confidence widens edges toward dependence.
- [ ] Re-score the whole register after the Phase-A dogfood cohort; re-rank the bet-the-product five.

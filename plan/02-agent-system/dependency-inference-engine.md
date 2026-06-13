# Dependency-Inference Engine (the crux)

> Status: **Canonical.** This is the make-or-break subsystem. If branch independence is wrong, parallelism is dangerous and the whole product loses trust. Everything here optimizes for **grounded, evidence-backed, user-ratifiable** dependency claims — never magic.

## 1. The problem, stated honestly

Before any code is written, we must predict **which changes depend on which** and therefore **which branches can run in parallel without conflict**. This is hard because:

- The code that creates the dependency *does not exist yet* — we're reasoning about *intended* changes.
- Two "independent" changes routinely collide on a shared file, a mutated symbol, a changed signature, a shared type, a config key, or a DB migration.
- An LLM asked "are these independent?" will confidently guess. Guesses are unacceptable when the cost of being wrong is a corrupted parallel merge.

**Design stance:** treat the DAG as a **ratified hypothesis**. Ground every claim in the repo's real symbol graph, show the evidence, detect *false independence* aggressively, and let the user correct it. Bias toward declaring a dependency when uncertain (a false dependency only costs lost parallelism; a false independence costs a corrupted merge).

## 2. Inputs & outputs

**Inputs**
- The Planner's `Nodes[]`, each with a **predicted touch-set** (`add/modify/delete` of files/symbols/types/routes/tables — see `data-model.md §5`).
- The repo index from the Python analysis service: **symbol graph**, **import graph**, **call graph**, **file↔symbol map**, type/schema/config references.

**Outputs**
- `Edges[]` with `type`, `evidence`, `overlap_score`.
- `Branches[]` partition with pairwise `independent` booleans and `independent_of[]`.
- Per-node `resolution_confidence`; per-edge confidence.
- A list of **false-independence flags** (would-be-parallel pairs that actually conflict).

## 3. Pipeline (7 stages)

```
(1) Index ─▶ (2) Decompose ─▶ (3) Resolve touch-sets ─▶ (4) Derive edges
      ─▶ (5) Classify independence / conflict ─▶ (6) Build DAG + branches ─▶ (7) Ratify (UI)
```

### Stage 1 — Repo index  *(Python analysis service)*
- Parse with **tree-sitter** → symbols (functions, classes, types, exports, routes), imports, references.
- Build with **networkx**: `import_graph` (file→file), `call_graph` (symbol→symbol), `type_graph` (symbol→type). Persist + cache (`cache:symbolgraph:{project}:{commit}`).
- Detect framework/config surfaces (routers, DI containers, env/config files, migration dirs) so cross-cutting touches (config, schema) are first-class.

### Stage 2 — Decompose  *(Planner, Opus)*
- Produce Nodes at the detected granularity; each node’s **predicted touch-set** is *schema-forced* (no prose). Predictions may be coarse (e.g. "modify `login`") — Stage 3 resolves them.

### Stage 3 — Resolve touch-sets to real symbols  *(analysis service)*
- Map predicted symbols → actual graph nodes (fuzzy match on name + file + kind; flag unresolved as **new** symbols).
- Expand to the **true blast radius**:
  - `modify(symbol)` → that symbol's file + all **callers** (call_graph reverse) that may break.
  - `change_signature(symbol)` → all call sites (hard dependency on every caller node).
  - `modify(type)` → all symbols referencing the type.
  - `migration(table/column)` → all symbols querying it; all later migrations.
  - `config_key` / `route` / DI registration → all consumers.
- Emit `resolved` touch-set + `resolution_confidence`. Unresolved predictions lower confidence and force a `soft_order` rather than a hard claim.

### Stage 4 — Derive edges
For each ordered pair (A, B), create an edge **A → B (B depends on A)** when any hold:
| Rule | Edge `evidence.reason` | Strength |
|------|------------------------|----------|
| B consumes a symbol A **creates** | `symbol_dependency` | hard |
| B calls/uses a symbol whose **signature** A changes | `signature_change` | hard |
| B references a **type/schema** A changes | `data_flow` / `schema_dependency` | hard |
| B's migration must run after A's migration | `sequence` | hard (ordered) |
| A and B **modify the same file** (no symbol-level provider/consumer) | `file_overlap` | soft → conflict risk |
| Domain ordering the planner asserts (e.g. "scaffold before wiring") | `soft_order` | soft |

### Stage 5 — Classify independence / conflict  *(this is the safety core)*
For each pair **not** connected by a hard edge, decide if they can run in **parallel**:

```
overlap_score(A,B) = weighted(
    file_overlap            (same path touched)      * 1.0   // hard blocker
  + symbol_overlap          (same symbol mutated)    * 1.0   // hard blocker
  + shared_signature_target (both touch one signature)*0.9
  + shared_schema_key       (same table/column)      * 0.9
  + shared_config_key       (same env/DI key)        * 0.7
  + sibling_in_same_module  (proximity heuristic)    * 0.2   // soft signal only
)
independent(A,B) := (no hard edge) AND (overlap_score < ε_file) AND (no shared mutated symbol/file)
```
- **False-independence detection:** any pair the planner *wanted* parallel but that has `file_overlap > 0` or a shared mutated symbol is **flagged**, the conflicting path/symbol is cited, and the pair is demoted to sequential (or split — see §6).
- **Uncertainty → dependency:** if `resolution_confidence` is low for either node, do **not** assert independence; add a `soft_order` and mark "needs ratification".

### Stage 6 — Build DAG + branches
- Construct the directed graph from hard + soft edges; **break cycles** by demoting the weakest soft edge in each cycle (log it) or merging mutually-dependent nodes.
- **Branch partition:** find weakly-connected components of the *hard-edge* subgraph; within a component, nodes on disjoint paths with `overlap_score≈0` form parallelizable **Branches**. Record `independent_of[]` per branch (proven-disjoint touch-sets).
- Insert **Integration nodes** where branches reconverge (`integration-merge.md`).

### Stage 7 — Ratify (UI handshake)
- Every independence claim renders **why** (the disjoint touch-sets) and every dependency renders its `evidence`. The user can:
  - **Confirm** a branch as independent (locks it for parallel dispatch),
  - **Add** a dependency the engine missed (becomes a hard edge),
  - **Split** a node to remove a conflict (see §6).
- Ratification state is persisted; execution (`parallel-orchestration.md`) **only** parallelizes ratified-or-high-confidence-independent branches.

## 4. The honesty guarantees (non-negotiable)

1. **Never present independence as a guarantee.** UI label is "Independent — no shared files/symbols detected", with evidence, not "Safe to parallelize, trust us".
2. **Asymmetric caution.** When unsure, assert a dependency. Lost parallelism is cheap; a bad merge is expensive.
3. **Runtime backstop.** Even a ratified-independent branch acquires `lock:file:{project}:{path}` per touched file at build time; if a build touches a file another running branch holds, it **blocks/serializes** with a visible reason — physical safety net behind the predicted one (`parallel-orchestration.md`).
4. **Drift re-derivation.** If a build's actual diff touches files outside its predicted touch-set, the engine re-runs Stages 3–6 on the affected nodes and the UI shows the drift (`replan-and-drift.md`).

## 5. Why grounding (not pure LLM) is the design

- The LLM is excellent at *proposing* decomposition and *explaining* a dependency, and unreliable at *enumerating* every caller of a changed function. The symbol/call graph enumerates callers deterministically.
- So: **LLM proposes touch-sets and reads evidence; the graph computes the blast radius and overlaps.** The final independence decision is a deterministic function of resolved touch-sets, with the LLM used only to (a) resolve ambiguous predictions and (b) author human-readable `rationale`.

## 6. Conflict resolution strategies (when two desired-parallel nodes collide)

| Strategy | When | Mechanism |
|----------|------|-----------|
| **Serialize** | Small overlap, ordering acceptable | demote to `depends_on`/`sequence` edge |
| **Split node** | Overlap is in a separable slice | planner re-decomposes the conflicting node into a shared-prerequisite node + two independent children |
| **Extract shared prerequisite** | Both need a new shared symbol | hoist the shared change into a parent node both depend on |
| **Lock-and-merge** | Unavoidable same-file edits | run sequentially under `lock:file`, or route both into one branch with an integration node |

## 7. Data contracts (analysis-service API)

```
POST /index            { project_id, commit }                    -> { index_id, stats }
GET  /symbol-graph     ?project&commit                           -> { symbols, imports, calls, types }
POST /resolve-touchset { commit, predicted_touchset }            -> { resolved, blast_radius, confidence }
POST /overlap          { commit, touchset_a, touchset_b }        -> { overlap_score, shared:{files,symbols,schema,config} }
POST /callgraph-impact { commit, symbol, kind:"signature|body" } -> { affected_symbols[], affected_files[] }
```
All schema-validated (pydantic ↔ shared JSON Schema ↔ zod). Stateless; cache-backed by Redis.

## 8. Evaluation (how we know it works — gates in `testing-and-eval.md`)

- **Golden repos** with hand-labeled change sets and known dependency graphs.
- **Metrics:**
  - *False-independence rate* (FIR): fraction of "independent" branch pairs that actually conflict on execution. **Primary safety metric — target near-zero.**
  - *Dependency precision/recall* vs labels.
  - *Parallel correctness*: % of parallel dispatches that merge clean.
  - *Speedup*: wall-clock vs sequential on G3 plans.
- **Adversarial cases** in the suite: hidden shared config, transitive type changes, same-file disjoint edits, migration ordering, dynamic dispatch.

## 9. Failure modes & mitigations

| Failure | Mitigation |
|---------|------------|
| Predicted touch-set misses a file the build will touch | runtime `lock:file` backstop + drift re-derivation (§4.3–4.4) |
| Dynamic/reflective dependency invisible to static graph | conservative default; flag node as "low static confidence"; serialize |
| Graph too large at G4 | cluster into super-nodes; derive dependencies at cluster boundaries first, expand on demand |
| LLM resolves a symbol wrong | fuzzy-match confidence threshold; unresolved → new-symbol path; never silently bind |
| Cyclic dependencies | break weakest soft edge or merge nodes; always log the broken edge |

---

## To-do list

### Analysis service (Python)
- [ ] `index_repo` — tree-sitter parse for TS/JS → symbol/import/call/type graphs; persist + cache.
- [ ] Incremental re-index on new commit (diff-driven).
- [ ] `resolve-touchset` — predicted→real symbol resolution with confidence + new-symbol detection.
- [ ] Blast-radius expansion (callers, signature call-sites, type refs, schema/config consumers).
- [ ] `overlap` — file/symbol/signature/schema/config overlap scoring.
- [ ] `callgraph-impact` — reverse-reachability for signature changes.
- [ ] Framework-surface detectors (routers, DI, env/config, migrations dirs).
- [ ] Python-language grammar (phase 2).

### Engine (Node worker)
- [ ] Edge-derivation rules (Stage 4) over resolved touch-sets.
- [ ] Independence/overlap classifier (Stage 5) with asymmetric-caution defaults.
- [ ] False-independence detector with cited conflicts.
- [ ] DAG builder + cycle breaking + branch partition + integration-node insertion.
- [ ] Confidence propagation (resolution → edge → branch).
- [ ] Conflict-resolution strategies (serialize / split / hoist).
- [ ] Drift re-derivation hook (consumes builder actual-diff).

### Ratification & contracts
- [ ] Persist evidence + ratification state on edges/branches.
- [ ] API to confirm/add/split from the UI (ties to `graph-canvas.md`).
- [ ] Shared JSON Schemas (pydantic ↔ zod) for touch-set/edge/overlap.

### Eval
- [ ] Golden-repo harness + labels.
- [ ] FIR, precision/recall, parallel-correctness, speedup metrics in CI.
- [ ] Adversarial case suite (hidden config, transitive types, same-file disjoint, migration order, dynamic dispatch).

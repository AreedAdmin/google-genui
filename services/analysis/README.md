# Trellis — Analysis Service (Python)

The **dependency-analysis service** for the Trellis dependency-inference engine.
It parses a checked-out repo with **tree-sitter** (TypeScript/JavaScript), builds
**symbol / import / call / type graphs** with **networkx**, and exposes the
grounding API the Node engine consumes to compute branch independence.

See `plan/02-agent-system/dependency-inference-engine.md` (§3 pipeline, §7 API)
and `plan/01-architecture/data-model.md` §5 (the `touch_set` shape).

## Run

```bash
cd services/analysis
uv sync                          # install deps (fastapi, tree-sitter, networkx, redis, ...)
uv run uvicorn app.main:app --reload --port 8000
```

If `tree-sitter-languages` does not provide a wheel on your host, install the
standalone grammars instead:

```bash
uv sync --extra grammars         # adds tree-sitter-typescript / tree-sitter-javascript
```

Open http://localhost:8000/docs for the interactive OpenAPI UI.

## Environment

Read from the process env / a local `.env` (see the repo-root `.env.example` §4, §8):

| Var | Default | Purpose |
|-----|---------|---------|
| `ANALYSIS_SERVICE_PORT` | `8000` | informational port |
| `TREE_SITTER_LANGUAGES` | `typescript,javascript` | grammars to load (comma-separated) |
| `REDIS_URL` | _(unset)_ | optional; mirrors graphs to `cache:symbolgraph:{project}:{commit}` (24h TTL). The service degrades gracefully to an in-memory cache when Redis is absent or unreachable. |
| `LOG_LEVEL` | `info` | log verbosity |

## Endpoints

| Method | Path | Body / Query | Returns |
|--------|------|--------------|---------|
| `POST` | `/index` | `{ project_id, repo_path, commit }` | `{ index_id, stats }` |
| `GET`  | `/symbol-graph` | `?project&commit` | `{ symbols, imports, calls, types, stats }` |
| `POST` | `/resolve-touchset` | `{ project_id, commit, predicted_touchset }` | `{ resolved, blast_radius, confidence, matches, new_symbols }` |
| `POST` | `/overlap` | `{ project_id, commit, touchset_a, touchset_b }` | `{ overlap_score, shared, hard_conflict }` |
| `POST` | `/callgraph-impact` | `{ project_id, commit, symbol, kind }` | `{ affected_symbols, affected_files, root }` |
| `GET`  | `/health` | — | `{ ok: true }` |

`resolved` uses the canonical `touch_set` field names from data-model §5:
`files`, `symbols`, `signatures_changed`, `schema_keys`, `config_keys`.

## Example

```bash
# 1) Index a checked-out repo dir
curl -s localhost:8000/index -H 'content-type: application/json' -d '{
  "project_id": "proj_1", "repo_path": "/path/to/checkout", "commit": "abc123"
}'

# 2) Resolve a Planner touch-set against the real graph
curl -s localhost:8000/resolve-touchset -H 'content-type: application/json' -d '{
  "project_id": "proj_1", "commit": "abc123",
  "predicted_touchset": {
    "modify": [{ "kind": "function", "name": "login", "file": "src/auth/index.ts",
                 "change_signature": true }]
  }
}'

# 3) Score overlap between two resolved touch-sets
curl -s localhost:8000/overlap -H 'content-type: application/json' -d '{
  "project_id": "proj_1", "commit": "abc123",
  "touchset_a": { "files": ["src/auth/index.ts"], "symbols": ["src/auth/index.ts#login"] },
  "touchset_b": { "files": ["src/auth/index.ts"], "symbols": [] }
}'

# 4) Reverse-reachability for a signature change
curl -s localhost:8000/callgraph-impact -H 'content-type: application/json' -d '{
  "project_id": "proj_1", "commit": "abc123",
  "symbol": "src/auth/index.ts#login", "kind": "signature"
}'
```

## Layout

```
app/
  main.py       FastAPI app + routes + index orchestration
  parser.py     tree-sitter parsing -> symbols / imports / calls / type refs
  graph.py      networkx symbol/import/call/type graphs (+ JSON (de)serialise)
  resolve.py    touch-set resolution (fuzzy match) + blast-radius expansion
  overlap.py    weighted file/symbol/signature/schema/config overlap scoring
  cache.py      two-tier (in-memory + optional Redis) graph cache
  models.py     pydantic request/response models (canonical touch_set names)
  settings.py   env via pydantic-settings
```

## Robustness

* A file that fails to parse (or a missing grammar) is **skipped and counted**
  in `stats.skipped_files`; indexing never crashes on a single bad file.
* Redis is **best-effort**: connection/read/write errors fall back to memory.
* `.d.ts` files, `node_modules`, build output and dot-dirs are ignored.

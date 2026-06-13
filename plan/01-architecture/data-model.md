# Data Model

> Status: **Canonical.** Postgres (Supabase) schema, enums, JSON shapes, Redis key schema, and storage buckets. All entity/field names here are authoritative — other docs reference these names.

## 1. Enums

```
granularity      : g1_micro | g2_meso | g3_macro | g4_mega
change_type      : migration | api_contract | ui_component | logic | refactor
                 | bugfix | config | infra | test | docs
plan_status      : draft | planning | ready | executing | partially_merged | merged | archived | failed
node_status      : pending | ready | running | built | merged | failed | blocked | skipped
edge_type        : depends_on | data_flow | sequence | soft_order
branch_status    : idle | ready | running | built | merged | conflicted | failed
run_kind         : plan | analysis | node_build | integration | replan
run_status       : queued | running | succeeded | failed | cancelled
share_role       : viewer | runner | editor
delegation_status: draft | sent | accepted | building | returned | merged | declined
```

## 2. Core tables

### organizations
| col | type | notes |
|-----|------|-------|
| id | uuid pk | |
| name | text | |
| created_at | timestamptz | |

### profiles  *(1:1 with `auth.users`)*
| id (uuid pk = auth uid) · org_id (fk) · display_name · avatar_url · default_role · created_at |

### projects
| id pk · org_id fk · name · repo_url · provider (github/upload) · default_branch · languages text[] · created_by fk · created_at |
- A project is a connected repository. Indexing artifacts are referenced via `repo_index`.

### repo_index
| id pk · project_id fk · commit_sha · symbol_graph_path (storage) · import_graph_path · file_symbol_map_path · stats jsonb · indexed_at |
- One row per indexed commit. Hot copy cached in Redis (`cache:symbolgraph:{project}:{commit}`).

### plans
| col | type | notes |
|-----|------|-------|
| id | uuid pk | |
| project_id | fk | |
| title | text | |
| prompt | text | original intent |
| granularity | granularity | detected, user-overridable |
| status | plan_status | |
| base_commit | text | commit the plan is planned against |
| current_revision | int | bumps on re-plan |
| created_by | fk | |
| created_at / updated_at | timestamptz | |

### plan_revisions
| id pk · plan_id fk · revision int · reason text · diff jsonb · created_by · created_at |
- Every re-plan writes a revision; the canvas can diff revisions (`replan-and-drift.md`).

### plan_nodes
| col | type | notes |
|-----|------|-------|
| id | uuid pk | |
| plan_id | fk | |
| revision | int | which revision introduced/last-changed it |
| title | text | |
| change_type | change_type | drives the widget |
| granularity | granularity | a node may be finer than its plan (super-node expansion) |
| status | node_status | |
| summary | text | short description of the change |
| touch_set | jsonb | predicted + resolved files/symbols (see §5) |
| position | jsonb | `{x,y}` canvas coords (layout cache) |
| branch_id | fk → branches | nullable until partitioned |
| parent_node_id | fk → plan_nodes | nullable; set when this node is a sub-node of a super-node (G4) |
| worktree_ref | text | set while/after building |
| diff_artifact_path | text | storage path of produced diff |
| confidence | numeric | engine confidence 0..1 |
| created_at / updated_at | | |

### node_annotations  *(P2 — the five-section content)*
| col | type | notes |
|-----|------|-------|
| node_id | fk pk | 1:1 with node (per revision) |
| revision | int | |
| assumptions | jsonb | `[{text, grounded_refs[], confidence}]` |
| analysis | jsonb | `[{kind: race_condition|failure_mode|edge_case|perf|security, text, grounded_refs[], severity, confidence}]` |
| benefits | jsonb | `[{text, grounded_refs[]}]` |
| notable_symbols | jsonb | `[{symbol, file, role, why_notable}]` |
| widget_specs | jsonb | validated specs for change-type widgets (see `widget-generation.md`) |
| model | text · tokens int · cost numeric · generated_at |

### plan_edges
| id pk · plan_id fk · revision int · from_node fk · to_node fk · type edge_type · rationale text · evidence jsonb · overlap_score numeric |
- `evidence`: the symbols/files justifying the dependency (rendered in UI). `overlap_score` 0..1.

### branches  *(parallelizable lanes)*
| id pk · plan_id fk · label · node_ids uuid[] · status branch_status · assignee_user_id fk(null) · worktree_path text(null) · independent_of uuid[] (branch ids proven independent) · created_at |

### runs
| id pk · plan_id fk · node_id fk(null) · branch_id fk(null) · kind run_kind · status run_status · agent text · model text · started_at · finished_at · tokens int · cost numeric · logs_stream_key text · result jsonb · error text |
- `logs_stream_key` → Redis Stream for live logs; final logs archived to Storage.

### integration_nodes  *(branch reconvergence)*
| id pk · plan_id fk · target_branches uuid[] · status (pending/merging/conflicted/merged/failed) · conflict_report jsonb(null) · merge_commit text(null) |

### delegations
| id pk · plan_id fk · subtree_root_node fk · spec_path (storage) · assigned_to_user fk(null) · assigned_to_email text(null) · role share_role · status delegation_status · base_commit · created_by · created_at |

### shares
| id pk · resource_type (plan/project) · resource_id · principal_user fk(null) · principal_email text(null) · role share_role · created_by · created_at |

### comments
| id pk · node_id fk · author fk · body text · resolved bool · created_at |

### events  *(audit + realtime fan-out)*
| id pk · plan_id fk · actor fk(null) · type text · payload jsonb · created_at |

### feedback  *(trust loop for analysis)*
| id pk · node_id fk · annotation_path text · vote (up/down) · reason text(null) · user fk · created_at |
- Down-votes feed suppression of analysis patterns (`analysis-annotation-agent.md`).

## 3. Relationships (text ERD)

```
organizations 1─* projects 1─* plans 1─* plan_nodes 1─1 node_annotations
                                   plans 1─* plan_edges (from_node/to_node → plan_nodes)
                                   plans 1─* branches  (branch *─* nodes via node.branch_id)
                                   plans 1─* runs       (run → node? branch?)
                                   plans 1─* integration_nodes
                                   plans 1─* delegations (→ subtree_root node)
profiles *─* plans via shares; profiles *─1 organizations
plan_nodes 0..1 parent_node_id → plan_nodes (super-node → sub-nodes)
```

## 4. Row-Level Security (summary; full policy in `security-and-auth.md`)

- Default deny. A row is visible if `org_id` matches the caller's org **and** (caller is org member with access to the project **or** an explicit `shares`/`delegations` grant exists).
- `runner` can create `runs`; `editor` can write nodes/edges/replan; `viewer` read-only.
- Service-role (workers) bypasses RLS but scopes every query by `plan_id`/`project_id` explicitly.

## 5. Key JSON shapes

```jsonc
// plan_nodes.touch_set
{
  "predicted": {                      // from the Planner (pre-resolution)
    "add":    [{ "kind": "function|file|type|route|table|...", "name": "createSession", "file": "src/auth/session.ts" }],
    "modify": [{ "kind": "function", "name": "login", "file": "src/auth/index.ts" }],
    "delete": []
  },
  "resolved": {                       // from the analysis service (real symbols)
    "files":   ["src/auth/index.ts", "src/auth/session.ts"],
    "symbols": ["src/auth/index.ts#login", "src/auth/session.ts#createSession"],
    "signatures_changed": ["src/auth/index.ts#login(req,res)->Promise<Session>"],
    "schema_keys": [],                // db tables/columns touched
    "config_keys": []
  },
  "resolution_confidence": 0.82
}
```

```jsonc
// plan_edges.evidence  (why a dependency exists)
{
  "reason": "symbol_dependency",                  // symbol_dependency | file_overlap | data_flow | signature_change | schema_dependency | sequence
  "shared": ["src/auth/index.ts#login"],
  "from_provides": ["createSession"],
  "to_consumes": ["createSession"],
  "overlap_score": 0.0                            // 0 = no file overlap (safe parallel); >0 = potential conflict
}
```

```jsonc
// node_annotations.widget_specs  (validated against component registry)
[
  { "widget": "schema_diff",      "props": { "before": {...}, "after": {...} } },
  { "widget": "api_contract",     "props": { "endpoint": "POST /login", "request": {...}, "response": {...} } },
  { "widget": "call_graph_impact","props": { "root": "login", "affected": [...] } }
]
```

## 6. Redis key schema

| Pattern | Type | TTL | Purpose |
|---------|------|-----|---------|
| `queue:{plan-build,node-run,analysis,integration,replan}` | BullMQ | — | job queues |
| `cache:symbolgraph:{project}:{commit}` | string(json) | 24h | indexed symbol graph |
| `cache:touchset:{node}:{rev}` | string(json) | 6h | resolved touch-set |
| `lock:plan:{id}` / `lock:branch:{id}` / `lock:node:{id}` | string (Redlock) | 60s | no double-dispatch |
| `lock:file:{project}:{path}` | string (Redlock) | run-bound | cross-branch file-overlap guard |
| `stream:run:{id}` | stream | trimmed | live logs/tokens/diff chunks |
| `presence:plan:{id}` | hash + pub/sub | 30s heartbeat | who's viewing/editing |
| `ratelimit:org:{id}` / `ratelimit:user:{id}` | token bucket | rolling | cost & abuse guards |

## 7. Storage buckets (Supabase Storage)

| Bucket | Contents |
|--------|----------|
| `repo-index` | symbol/import/call graph artifacts per `repo_index` row |
| `diffs` | per-node/per-run unified diffs |
| `logs` | archived run logs (live copy is the Redis stream) |
| `specs` | exported subtree portable specs (`delegations.spec_path`) |

## 8. Indexing & integrity notes

- Indexes on `plan_nodes(plan_id, revision)`, `plan_edges(plan_id, revision)`, `runs(plan_id, status)`, `branches(plan_id)`, `delegations(plan_id, status)`.
- FK `on delete cascade` from `plans` → nodes/edges/branches/runs/annotations; `restrict` from `projects` → `plans`.
- `runs.id` is the idempotency key for worker execution (a re-queued run is a no-op if already `succeeded`).
- All mutable domain tables carry `revision` so the canvas can render any historical plan state.

-- Trellis initial schema — mirrors plan/01-architecture/data-model.md
-- Target: Supabase Postgres (auth schema + auth.uid()/auth.jwt() available).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- enums (data-model.md §1)
-- ---------------------------------------------------------------------------
do $$ begin
  create type granularity as enum ('g1_micro','g2_meso','g3_macro','g4_mega');
  create type change_type as enum ('migration','api_contract','ui_component','logic','refactor','bugfix','config','infra','test','docs');
  create type plan_status as enum ('draft','planning','ready','executing','partially_merged','merged','archived','failed');
  create type node_status as enum ('pending','ready','running','built','merged','failed','blocked','skipped');
  create type edge_type as enum ('depends_on','data_flow','sequence','soft_order');
  create type branch_status as enum ('idle','ready','running','built','merged','conflicted','failed');
  create type run_kind as enum ('plan','analysis','node_build','integration','replan');
  create type run_status as enum ('queued','running','succeeded','failed','cancelled');
  create type share_role as enum ('viewer','runner','editor');
  create type delegation_status as enum ('draft','sent','accepted','building','returned','merged','declined');
  create type execution_backend as enum ('claude_code','native');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- core tables
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete restrict,
  display_name text,
  avatar_url text,
  default_role share_role not null default 'editor',
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  name text not null,
  repo_url text not null,
  provider text not null default 'github',
  default_branch text not null default 'main',
  languages text[] not null default '{}',
  execution_backend execution_backend not null default 'claude_code',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table repo_index (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  commit_sha text not null,
  symbol_graph_path text,
  import_graph_path text,
  file_symbol_map_path text,
  stats jsonb not null default '{}',
  indexed_at timestamptz not null default now()
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete restrict,
  title text not null,
  prompt text not null,
  granularity granularity not null,
  status plan_status not null default 'draft',
  base_commit text not null default '',
  current_revision int not null default 1,
  layout_spec jsonb,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table plan_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  revision int not null,
  reason text,
  diff jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  label text not null,
  node_ids uuid[] not null default '{}',
  status branch_status not null default 'idle',
  assignee_user_id uuid references profiles(id),
  worktree_path text,
  independent_of uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table plan_nodes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  revision int not null default 1,
  title text not null,
  change_type change_type not null,
  granularity granularity not null,
  status node_status not null default 'pending',
  summary text not null default '',
  touch_set jsonb not null default '{}',
  position jsonb not null default '{"x":0,"y":0}',
  branch_id uuid references branches(id) on delete set null,
  parent_node_id uuid references plan_nodes(id) on delete set null,
  worktree_ref text,
  diff_artifact_path text,
  confidence numeric not null default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table node_annotations (
  node_id uuid primary key references plan_nodes(id) on delete cascade,
  revision int not null default 1,
  assumptions jsonb not null default '[]',
  analysis jsonb not null default '[]',
  benefits jsonb not null default '[]',
  notable_symbols jsonb not null default '[]',
  widget_specs jsonb not null default '[]',
  model text,
  tokens int not null default 0,
  cost numeric not null default 0,
  generated_at timestamptz
);

create table plan_edges (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  revision int not null default 1,
  from_node uuid not null references plan_nodes(id) on delete cascade,
  to_node uuid not null references plan_nodes(id) on delete cascade,
  type edge_type not null,
  rationale text not null default '',
  evidence jsonb not null default '{}',
  overlap_score numeric not null default 0
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  node_id uuid references plan_nodes(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  kind run_kind not null,
  status run_status not null default 'queued',
  agent text not null default '',
  model text not null default '',
  started_at timestamptz,
  finished_at timestamptz,
  tokens int not null default 0,
  cost numeric not null default 0,
  logs_stream_key text,
  result jsonb,
  error text
);

create table integration_nodes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  target_branches uuid[] not null default '{}',
  status text not null default 'pending',
  conflict_report jsonb,
  merge_commit text
);

create table delegations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  subtree_root_node uuid not null references plan_nodes(id) on delete cascade,
  spec_path text,
  assigned_to_user uuid references profiles(id),
  assigned_to_email text,
  role share_role not null default 'runner',
  status delegation_status not null default 'draft',
  base_commit text not null default '',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table shares (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in ('plan','project')),
  resource_id uuid not null,
  principal_user uuid references profiles(id),
  principal_email text,
  role share_role not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references plan_nodes(id) on delete cascade,
  author uuid not null references profiles(id),
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references plans(id) on delete cascade,
  actor uuid references profiles(id),
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references plan_nodes(id) on delete cascade,
  annotation_path text,
  vote text not null check (vote in ('up','down')),
  reason text,
  "user" uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------------
create index on plan_nodes (plan_id, revision);
create index on plan_edges (plan_id, revision);
create index on runs (plan_id, status);
create index on branches (plan_id);
create index on delegations (plan_id, status);
create index on events (plan_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS helpers (security-and-auth.md §3)
-- ---------------------------------------------------------------------------
create or replace function auth_org() returns uuid language sql stable as
  $$ select (auth.jwt() ->> 'org_id')::uuid $$;

create or replace function role_rank(r share_role) returns int language sql immutable as
  $$ select case r when 'viewer' then 1 when 'runner' then 2 when 'editor' then 3 end $$;

create or replace function can_access_plan(p_plan uuid, min_role share_role)
returns boolean language sql stable as $$
  select exists (
    select 1 from plans pl
    join projects pr on pr.id = pl.project_id
    where pl.id = p_plan
      and (
        exists (select 1 from profiles me where me.id = auth.uid() and me.org_id = pr.org_id)
        or exists (
          select 1 from shares s
          where s.resource_id = pl.id and s.resource_type = 'plan'
            and (s.principal_user = auth.uid() or s.principal_email = (auth.jwt() ->> 'email'))
            and role_rank(s.role) >= role_rank(min_role)
        )
        or exists (
          select 1 from delegations d
          where d.plan_id = pl.id
            and (d.assigned_to_user = auth.uid() or d.assigned_to_email = (auth.jwt() ->> 'email'))
            and role_rank(d.role) >= role_rank(min_role)
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS (default deny; service-role bypasses). Read=viewer, write=editor,
-- run-insert=runner. Child tables inherit access from their parent plan.
-- ---------------------------------------------------------------------------
alter table plans enable row level security;
create policy plans_select on plans for select using ( can_access_plan(id, 'viewer') );
create policy plans_update on plans for update using ( can_access_plan(id, 'editor') ) with check ( can_access_plan(id, 'editor') );

alter table plan_nodes enable row level security;
create policy nodes_select on plan_nodes for select using ( can_access_plan(plan_id, 'viewer') );
create policy nodes_write  on plan_nodes for all    using ( can_access_plan(plan_id, 'editor') ) with check ( can_access_plan(plan_id, 'editor') );

alter table plan_edges enable row level security;
create policy edges_select on plan_edges for select using ( can_access_plan(plan_id, 'viewer') );

alter table branches enable row level security;
create policy branches_select on branches for select using ( can_access_plan(plan_id, 'viewer') );

alter table node_annotations enable row level security;
create policy annotations_select on node_annotations for select
  using ( exists (select 1 from plan_nodes n where n.id = node_id and can_access_plan(n.plan_id, 'viewer')) );

alter table runs enable row level security;
create policy runs_select on runs for select using ( can_access_plan(plan_id, 'viewer') );
create policy runs_insert on runs for insert with check ( can_access_plan(plan_id, 'runner') );

alter table delegations enable row level security;
create policy delegations_select on delegations for select
  using ( can_access_plan(plan_id, 'editor') or assigned_to_user = auth.uid() or assigned_to_email = (auth.jwt() ->> 'email') );
create policy delegations_insert on delegations for insert with check ( can_access_plan(plan_id, 'editor') );

alter table shares enable row level security;
create policy shares_insert on shares for insert with check ( true );
create policy shares_select on shares for select
  using ( created_by = auth.uid() or principal_user = auth.uid() or principal_email = (auth.jwt() ->> 'email') );

alter table comments enable row level security;
create policy comments_rw on comments for all
  using ( exists (select 1 from plan_nodes n where n.id = node_id and can_access_plan(n.plan_id, 'viewer')) )
  with check ( exists (select 1 from plan_nodes n where n.id = node_id and can_access_plan(n.plan_id, 'viewer')) );

alter table events enable row level security;
create policy events_select on events for select using ( can_access_plan(plan_id, 'viewer') );

alter table feedback enable row level security;
create policy feedback_rw on feedback for all
  using ( exists (select 1 from plan_nodes n where n.id = node_id and can_access_plan(n.plan_id, 'viewer')) )
  with check ( exists (select 1 from plan_nodes n where n.id = node_id and can_access_plan(n.plan_id, 'viewer')) );

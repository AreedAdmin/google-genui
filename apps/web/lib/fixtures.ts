import type { PlanGraph } from "@trellis/shared";
import type { PlanListItem, ProjectListItem } from "./api";

/**
 * Demo fixtures — one plan per granularity tier (G1–G4), so all four canvas
 * layouts render and the D17 demo works without a live API. Each plan carries a
 * validated LayoutSpec + grounded WidgetSpecs + the five inspector sections.
 * These are the same shape the API returns from GET /v1/plans/:id (PlanGraph).
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function uuid(seed: string): string {
  // Deterministic, fixture-stable pseudo-UUIDs (valid v4-ish shape).
  const h = seed.padEnd(32, "0").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const now = "2026-06-13T10:00:00.000Z";

// ============================================================================
// G1 — Micro · Diff-First (checklist)
// ============================================================================

const g1: PlanGraph = {
  plan: {
    id: "g1micro0-0000-4000-8000-000000000001",
    project_id: PROJECT_ID,
    title: "Tighten login validation",
    prompt: "Validate the email format before hashing in the login flow.",
    granularity: "g1_micro",
    status: "ready",
    base_commit: "a1b2c3d",
    current_revision: 1,
    layout_spec: {
      tier: "g1_micro",
      canvas: "checklist",
      direction: "TB",
      grouping: null,
      emphasis: ["diff"],
      parallelism_ui: "hidden",
      delegation_ui: "share_diff",
      semantic_zoom: false,
      default_inspector_tab: "changes",
    },
    created_by: uuid("user1"),
    created_at: now,
    updated_at: now,
  },
  nodes: [
    {
      id: uuid("g1n1"),
      plan_id: "g1micro0-0000-4000-8000-000000000001",
      revision: 1,
      title: "Validate email before hashing",
      change_type: "bugfix",
      granularity: "g1_micro",
      status: "ready",
      summary: "Guard the login handler against malformed emails before the password hash compare.",
      touch_set: {
        predicted: {
          add: [],
          modify: [{ kind: "function", name: "login", file: "src/auth/index.ts" }],
          delete: [],
        },
        resolved: {
          files: ["src/auth/index.ts", "src/auth/validate.ts"],
          symbols: ["src/auth/index.ts#login", "src/auth/validate.ts#isEmail"],
          signatures_changed: [],
          schema_keys: [],
          config_keys: [],
        },
        resolution_confidence: 0.92,
      },
      position: { x: 0, y: 0 },
      branch_id: null,
      parent_node_id: null,
      worktree_ref: null,
      diff_artifact_path: null,
      confidence: 0.88,
    },
  ],
  edges: [],
  branches: [],
  annotations: [
    {
      node_id: uuid("g1n1"),
      revision: 1,
      assumptions: [
        {
          text: "`isEmail` already exists in the validation module and can be reused.",
          grounded_refs: ["src/auth/validate.ts#isEmail"],
          confidence: 0.9,
        },
        {
          text: "Login callers do not depend on the current throw-less behavior for empty emails.",
          grounded_refs: [],
          confidence: 0.4,
        },
      ],
      analysis: [
        {
          kind: "edge_case",
          text: "An empty `user.email` currently reaches `bcrypt.compare`, wasting a hash round-trip.",
          grounded_refs: ["src/auth/index.ts#login"],
          severity: "low",
          confidence: 0.86,
        },
        {
          kind: "security",
          text: "Validating shape before hashing narrows a user-enumeration timing channel.",
          grounded_refs: ["src/auth/index.ts#login"],
          severity: "medium",
          confidence: 0.71,
        },
      ],
      benefits: [
        { text: "Rejects malformed input one step earlier, with a clearer 400.", grounded_refs: ["src/auth/index.ts#login"] },
      ],
      notable_symbols: [
        { symbol: "login", file: "src/auth/index.ts", role: "handler", why_notable: "The single touched function — the whole change lives here." },
        { symbol: "isEmail", file: "src/auth/validate.ts", role: "helper", why_notable: "Reused validator; no new dependency added." },
      ],
      widget_specs: [
        {
          widget: "call_graph_impact",
          version: 1,
          props: {
            root: "src/auth/index.ts#login",
            affected: [
              { symbol: "src/auth/index.ts#login", file: "src/auth/index.ts", relation: "root", depth: 0, risk: "behavior" },
              { symbol: "src/auth/validate.ts#isEmail", file: "src/auth/validate.ts", relation: "callee", depth: 1, risk: "none" },
              { symbol: "src/routes/session.ts#postLogin", file: "src/routes/session.ts", relation: "caller", depth: 1, risk: "none" },
            ],
            blast_radius: { files: 3, symbols: 3, crosses_branches: false },
            truncated: false,
          },
          grounding: ["src/auth/index.ts#login", "src/auth/validate.ts#isEmail"],
          fallback_text: "login() now validates email shape before the hash compare; one caller, no signature change.",
        },
      ],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
  ],
};

// ============================================================================
// G2 — Meso · Compact DAG (the sweet spot)
// ============================================================================

const G2 = "g2meso00-0000-4000-8000-000000000002";
const brA = uuid("g2brA");
const brB = uuid("g2brB");

const g2: PlanGraph = {
  plan: {
    id: G2,
    project_id: PROJECT_ID,
    title: "Add OAuth login",
    prompt: "Add Google + GitHub OAuth login to the app.",
    granularity: "g2_meso",
    status: "ready",
    base_commit: "a1b2c3d",
    current_revision: 1,
    layout_spec: {
      tier: "g2_meso",
      canvas: "compact_dag",
      direction: "LR",
      grouping: null,
      emphasis: ["contracts", "tests"],
      parallelism_ui: "branch_buttons",
      delegation_ui: "per_branch",
      semantic_zoom: false,
      default_inspector_tab: "contract",
    },
    created_by: uuid("user1"),
    created_at: now,
    updated_at: now,
  },
  nodes: [
    mk("g2n1", G2, "oauth_accounts table", "migration", "ready", brA, "Create the oauth_accounts table linking providers to users.", {
      files: ["migrations/0007_add_oauth.sql", "src/db/schema.ts"],
      symbols: ["src/db/schema.ts#oauthAccounts"],
      schema_keys: ["oauth_accounts"],
    }),
    mk("g2n2", G2, "POST /auth/oauth/:provider", "api_contract", "ready", brA, "Exchange an OAuth code for a session; link or create the account.", {
      files: ["src/routes/oauth.ts", "src/auth/index.ts"],
      symbols: ["src/routes/oauth.ts#oauthHandler", "src/auth/index.ts#createSession"],
      signatures_changed: ["src/auth/index.ts#login: Session -> Promise<Session>"],
    }),
    mk("g2n3", G2, "LoginButton (provider buttons)", "ui_component", "ready", brA, "Add provider buttons that start the OAuth redirect.", {
      files: ["src/components/LoginButton.tsx"],
      symbols: ["src/components/LoginButton.tsx#LoginButton"],
    }),
    mk("g2n4", G2, "providers config", "config", "ready", brB, "Add OAuth client ids / secrets and the provider registry.", {
      files: ["src/config/providers.ts", ".env.example"],
      symbols: ["src/config/providers.ts#providers"],
      config_keys: ["OAUTH_GOOGLE_ID", "OAUTH_GOOGLE_SECRET", "OAUTH_GITHUB_ID"],
    }),
  ],
  edges: [
    edge("g2e1", G2, "g2n1", "g2n2", "depends_on", "OAuth route writes the oauth_accounts table.", {
      reason: "schema_dependency",
      shared: ["oauth_accounts"],
      from_provides: ["oauth_accounts"],
      to_consumes: ["oauth_accounts"],
      overlap_score: 0,
    }),
    edge("g2e2", G2, "g2n2", "g2n3", "data_flow", "Login button calls the OAuth route.", {
      reason: "symbol_dependency",
      shared: ["src/routes/oauth.ts#oauthHandler"],
      from_provides: ["oauthHandler"],
      to_consumes: ["oauthHandler"],
      overlap_score: 0,
    }),
    edge("g2e3", G2, "g2n4", "g2n2", "depends_on", "Route reads the provider registry/config.", {
      reason: "data_flow",
      shared: ["src/config/providers.ts#providers"],
      from_provides: ["providers"],
      to_consumes: ["providers"],
      overlap_score: 0,
    }),
  ],
  branches: [
    { id: brA, plan_id: G2, label: "OAuth core", node_ids: [uuid("g2n1"), uuid("g2n2"), uuid("g2n3")], status: "ready", assignee_user_id: null, worktree_path: null, independent_of: [brB] },
    { id: brB, plan_id: G2, label: "Provider config", node_ids: [uuid("g2n4")], status: "ready", assignee_user_id: null, worktree_path: null, independent_of: [brA] },
  ],
  annotations: [
    {
      node_id: uuid("g2n2"),
      revision: 1,
      assumptions: [
        { text: "The session shape is unchanged; OAuth just adds a creation path.", grounded_refs: ["src/auth/index.ts#createSession"], confidence: 0.83 },
        { text: "Providers expose a standard OAuth2 code-for-token exchange.", grounded_refs: [], web_sources: ["https://datatracker.ietf.org/doc/html/rfc6749"], confidence: 0.45 },
      ],
      analysis: [
        { kind: "race_condition", text: "Two concurrent first-time logins can both try to insert the same (provider, account_id).", grounded_refs: ["migrations/0007_add_oauth.sql", "src/routes/oauth.ts#oauthHandler"], severity: "high", confidence: 0.8 },
        { kind: "security", text: "The OAuth `state` parameter must be validated to prevent CSRF on the callback.", grounded_refs: ["src/routes/oauth.ts#oauthHandler"], web_sources: ["https://datatracker.ietf.org/doc/html/rfc6749#section-10.12"], severity: "high", confidence: 0.78 },
        { kind: "failure_mode", text: "A provider 5xx during token exchange should fail closed, not create a half-linked account.", grounded_refs: ["src/routes/oauth.ts#oauthHandler"], severity: "medium", confidence: 0.74 },
      ],
      benefits: [
        { text: "Removes password storage for social sign-ins.", grounded_refs: ["src/auth/index.ts#createSession"] },
        { text: "Reuses the existing session machinery — no new auth surface.", grounded_refs: ["src/auth/index.ts#createSession"] },
      ],
      notable_symbols: [
        { symbol: "oauthHandler", file: "src/routes/oauth.ts", role: "route", why_notable: "The new endpoint; owns the code exchange + account link." },
        { symbol: "createSession", file: "src/auth/index.ts", role: "shared", why_notable: "Reused to issue the session — signature changes to async." },
      ],
      widget_specs: [
        {
          widget: "api_contract",
          version: 1,
          props: {
            method: "POST",
            path: "/auth/oauth/:provider",
            request: {
              params: [{ name: "provider", type: '"google" | "github"', required: true, note: "path", change: "added" }],
              query: [],
              body: [
                { name: "code", type: "string", required: true, note: "authorization code", change: "added" },
                { name: "redirect", type: "string", required: false, change: "added" },
              ],
            },
            responses: [
              { status: 200, description: "session issued", body: [{ name: "session", type: "Session", required: true, change: "added" }, { name: "user", type: "User", required: true, change: "added" }] },
              { status: 401, description: "invalid grant", body: [{ name: "error", type: '"invalid_grant"', required: true, change: "added" }] },
              { status: 409, description: "account already linked", body: [{ name: "error", type: '"account_linked"', required: true, change: "added" }] },
            ],
            breaking: [
              { what: "login() return type Session → Promise<Session>", why: "OAuth path is async; callers in src/auth/index.ts must await.", severity: "high" },
            ],
          },
          grounding: ["src/routes/oauth.ts#oauthHandler", "src/auth/index.ts#createSession", "src/auth/index.ts#login"],
          fallback_text: "POST /auth/oauth/:provider — body {code, redirect?} → 200 {session,user} | 401 | 409. Breaking: login() now async.",
        },
        {
          widget: "call_graph_impact",
          version: 1,
          props: {
            root: "src/auth/index.ts#login",
            affected: [
              { symbol: "src/auth/index.ts#login", file: "src/auth/index.ts", relation: "root", depth: 0, risk: "signature" },
              { symbol: "src/routes/session.ts#postLogin", file: "src/routes/session.ts", relation: "caller", depth: 1, risk: "signature" },
              { symbol: "src/routes/oauth.ts#oauthHandler", file: "src/routes/oauth.ts", relation: "caller", depth: 1, risk: "none" },
            ],
            blast_radius: { files: 3, symbols: 3, crosses_branches: false },
            truncated: false,
          },
          grounding: ["src/auth/index.ts#login", "src/routes/session.ts#postLogin"],
          fallback_text: "login() signature change ripples to postLogin (must await).",
        },
      ],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
    {
      node_id: uuid("g2n1"),
      revision: 1,
      assumptions: [{ text: "users.id is a uuid primary key referenced by the FK.", grounded_refs: ["src/db/schema.ts#users"], confidence: 0.95 }],
      analysis: [{ kind: "perf", text: "The unique (provider, provider_account_id) index is required to dedupe links.", grounded_refs: ["migrations/0007_add_oauth.sql"], severity: "medium", confidence: 0.82 }],
      benefits: [{ text: "Normalizes multiple providers per user.", grounded_refs: ["src/db/schema.ts#oauthAccounts"] }],
      notable_symbols: [{ symbol: "oauthAccounts", file: "src/db/schema.ts", role: "table", why_notable: "New table; FK to users." }],
      widget_specs: [
        {
          widget: "schema_diff",
          version: 1,
          props: {
            kind: "table",
            before: null,
            after: {
              table: "oauth_accounts",
              columns: [
                { name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()", pk: true, fk: null },
                { name: "user_id", type: "uuid", nullable: false, default: null, pk: false, fk: "users.id" },
                { name: "provider", type: "text", nullable: false, default: null, pk: false, fk: null },
                { name: "provider_account_id", type: "text", nullable: false, default: null, pk: false, fk: null },
                { name: "created_at", type: "timestamptz", nullable: false, default: "now()", pk: false, fk: null },
              ],
              indexes: [{ name: "uq_provider_acct", cols: ["provider", "provider_account_id"], unique: true }],
            },
            ordering: { must_run_after: ["create users table"], reversible: true },
          },
          grounding: ["migrations/0007_add_oauth.sql", "src/db/schema.ts#oauthAccounts"],
          fallback_text: "New table oauth_accounts(id, user_id→users.id, provider, provider_account_id, created_at) + unique(provider, provider_account_id).",
        },
      ],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
    {
      node_id: uuid("g2n3"),
      revision: 1,
      assumptions: [{ text: "The button mounts inside the existing login form.", grounded_refs: ["src/components/LoginButton.tsx#LoginButton"], confidence: 0.7 }],
      analysis: [{ kind: "edge_case", text: "Disabled state needed while the redirect is in flight to prevent double submits.", grounded_refs: ["src/components/LoginButton.tsx#LoginButton"], severity: "low", confidence: 0.68 }],
      benefits: [{ text: "One component renders all providers from config.", grounded_refs: ["src/config/providers.ts#providers"] }],
      notable_symbols: [{ symbol: "LoginButton", file: "src/components/LoginButton.tsx", role: "component", why_notable: "The user-facing entry to OAuth." }],
      widget_specs: [
        {
          widget: "component_preview",
          version: 1,
          props: {
            name: "LoginButton",
            framework: "react",
            props: [
              { name: "provider", type: '"google" | "github"', required: true, default: null },
              { name: "loading", type: "boolean", required: false, default: "false" },
              { name: "onClick", type: "() => void", required: true, default: null },
            ],
            states: [
              { label: "default", propsJson: '{"provider":"google"}' },
              { label: "loading", propsJson: '{"provider":"google","loading":true}' },
              { label: "disabled", propsJson: '{"provider":"github","loading":true}' },
            ],
            preview: { mode: "skeleton", snippet_ref: null },
          },
          grounding: ["src/components/LoginButton.tsx#LoginButton"],
          fallback_text: "LoginButton(provider, loading?, onClick) — renders 'Continue with Google/GitHub'.",
        },
      ],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
    {
      node_id: uuid("g2n4"),
      revision: 1,
      assumptions: [{ text: "Secrets are injected via env, not committed.", grounded_refs: [".env.example"], confidence: 0.9 }],
      analysis: [{ kind: "security", text: "Client secrets must never reach the browser bundle.", grounded_refs: ["src/config/providers.ts#providers"], severity: "high", confidence: 0.84 }],
      benefits: [{ text: "Single registry to add new providers later.", grounded_refs: ["src/config/providers.ts#providers"] }],
      notable_symbols: [{ symbol: "providers", file: "src/config/providers.ts", role: "registry", why_notable: "Maps provider → endpoints + scopes." }],
      widget_specs: [
        {
          widget: "key_diff",
          version: 1,
          props: {
            keys: [
              { key: "OAUTH_GOOGLE_ID", before: null, after: "<env>", scope: "env", consumers: ["src/config/providers.ts"] },
              { key: "OAUTH_GOOGLE_SECRET", before: null, after: "<env>", scope: "env", consumers: ["src/config/providers.ts"] },
              { key: "OAUTH_GITHUB_ID", before: null, after: "<env>", scope: "env", consumers: ["src/config/providers.ts"] },
            ],
          },
          grounding: ["src/config/providers.ts#providers", ".env.example"],
          fallback_text: "Adds OAUTH_GOOGLE_ID/SECRET, OAUTH_GITHUB_ID — read by src/config/providers.ts.",
        },
      ],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
  ],
};

// ============================================================================
// G3 — Macro · Swimlane DAG (grouped by module)
// ============================================================================

const G3 = "g3macro0-0000-4000-8000-000000000003";
const g3brDb = uuid("g3brdb");
const g3brApi = uuid("g3brapi");
const g3brWeb = uuid("g3brweb");
const g3brInfra = uuid("g3brinfra");

const g3: PlanGraph = {
  plan: {
    id: G3,
    project_id: PROJECT_ID,
    title: "Extract billing into a service",
    prompt: "Pull billing out of the monolith into its own service with a clean client.",
    granularity: "g3_macro",
    status: "executing",
    base_commit: "a1b2c3d",
    current_revision: 1,
    layout_spec: {
      tier: "g3_macro",
      canvas: "swimlane_dag",
      direction: "LR",
      grouping: "by_module",
      emphasis: ["parallelism", "conflicts"],
      parallelism_ui: "dispatch_parallel",
      delegation_ui: "per_lane",
      semantic_zoom: false,
      default_inspector_tab: "analysis",
    },
    created_by: uuid("user1"),
    created_at: now,
    updated_at: now,
  },
  nodes: [
    mkLane("g3n1", G3, "Migrate ledger schema", "migration", "built", g3brDb, "db", "Move ledger tables to the billing schema.", { files: ["migrations/0012_ledger.sql"], schema_keys: ["billing.ledger"] }),
    mkLane("g3n2", G3, "Billing service client", "api_contract", "running", g3brApi, "api", "Typed client calling the new billing service.", { files: ["src/billing/client.ts", "src/checkout.ts"], symbols: ["src/billing/client.ts#BillingClient"], signatures_changed: ["src/checkout.ts#charge"] }),
    mkLane("g3n3", G3, "Wire billing routes", "logic", "ready", g3brApi, "api", "Point existing routes at the billing client.", { files: ["src/routes/billing.ts", "src/checkout.ts"], symbols: ["src/routes/billing.ts#chargeRoute"] }),
    mkLane("g3n4", G3, "Update checkout UI", "ui_component", "ready", g3brWeb, "web", "Use the new charge result shape in checkout.", { files: ["src/checkout.ts", "src/components/Checkout.tsx"], symbols: ["src/components/Checkout.tsx#Checkout"] }),
    mkLane("g3n5", G3, "New service deploy", "infra", "ready", g3brInfra, "infra", "Deploy the billing service container + queue.", { files: ["infra/billing.tf"], config_keys: ["BILLING_SVC_URL"] }),
    mkLane("g3n6", G3, "Integration: merge + tests", "test", "blocked", g3brApi, "api", "Reconverge branches; run the cross-service test suite.", { files: ["test/billing.e2e.ts"] }),
    mkLane("g3n7", G3, "Remove legacy billing", "refactor", "pending", g3brApi, "api", "Delete the in-monolith billing path.", { files: ["src/legacy/billing.ts"], symbols: ["src/legacy/billing.ts#legacyCharge"] }),
  ],
  edges: [
    edge("g3e1", G3, "g3n1", "g3n2", "depends_on", "Client targets the migrated schema.", { reason: "schema_dependency", shared: ["billing.ledger"], from_provides: ["billing.ledger"], to_consumes: ["billing.ledger"], overlap_score: 0 }),
    edge("g3e2", G3, "g3n2", "g3n3", "data_flow", "Routes use the client.", { reason: "symbol_dependency", shared: ["src/billing/client.ts#BillingClient"], from_provides: ["BillingClient"], to_consumes: ["BillingClient"], overlap_score: 0 }),
    edge("g3e3", G3, "g3n2", "g3n4", "data_flow", "Checkout UI consumes the new charge result shape — shares checkout.ts.", { reason: "file_overlap", shared: ["src/checkout.ts"], from_provides: ["charge"], to_consumes: ["charge"], overlap_score: 0.6 }),
    edge("g3e4", G3, "g3n3", "g3n6", "sequence", "Integration runs after routes are wired.", { reason: "sequence", shared: [], from_provides: [], to_consumes: [], overlap_score: 0 }),
    edge("g3e5", G3, "g3n4", "g3n6", "sequence", "Integration waits on the web change.", { reason: "sequence", shared: [], from_provides: [], to_consumes: [], overlap_score: 0 }),
    edge("g3e6", G3, "g3n5", "g3n3", "depends_on", "Routes need the service URL.", { reason: "data_flow", shared: ["BILLING_SVC_URL"], from_provides: ["BILLING_SVC_URL"], to_consumes: ["BILLING_SVC_URL"], overlap_score: 0 }),
    edge("g3e7", G3, "g3n6", "g3n7", "depends_on", "Legacy removal only after integration passes.", { reason: "sequence", shared: [], from_provides: [], to_consumes: [], overlap_score: 0 }),
  ],
  branches: [
    { id: g3brDb, plan_id: G3, label: "db", node_ids: [uuid("g3n1")], status: "built", assignee_user_id: uuid("user1"), worktree_path: null, independent_of: [g3brInfra] },
    // api and web share checkout.ts → NOT independent of each other (false-independence demo)
    { id: g3brApi, plan_id: G3, label: "api", node_ids: [uuid("g3n2"), uuid("g3n3"), uuid("g3n6"), uuid("g3n7")], status: "running", assignee_user_id: uuid("user2"), worktree_path: null, independent_of: [g3brWeb] },
    { id: g3brWeb, plan_id: G3, label: "web", node_ids: [uuid("g3n4")], status: "ready", assignee_user_id: uuid("user3"), worktree_path: null, independent_of: [g3brApi] },
    { id: g3brInfra, plan_id: G3, label: "infra", node_ids: [uuid("g3n5")], status: "ready", assignee_user_id: null, worktree_path: null, independent_of: [g3brDb, g3brApi, g3brWeb] },
  ],
  annotations: [
    {
      node_id: uuid("g3n2"),
      revision: 1,
      assumptions: [{ text: "The billing service exposes the same charge semantics over HTTP.", grounded_refs: ["src/billing/client.ts#BillingClient"], confidence: 0.7 }],
      analysis: [
        { kind: "race_condition", text: "api and web both edit src/checkout.ts — these 'independent' lanes share a file and must serialize.", grounded_refs: ["src/checkout.ts"], severity: "high", confidence: 0.86 },
        { kind: "failure_mode", text: "Network timeouts to the new service need a retry+circuit-breaker the monolith never had.", grounded_refs: ["src/billing/client.ts#BillingClient"], severity: "medium", confidence: 0.79 },
      ],
      benefits: [{ text: "Decouples billing deploys from the monolith.", grounded_refs: ["src/billing/client.ts#BillingClient"] }],
      notable_symbols: [{ symbol: "BillingClient", file: "src/billing/client.ts", role: "client", why_notable: "The new seam between monolith and service." }],
      widget_specs: [
        {
          widget: "call_graph_impact",
          version: 1,
          props: {
            root: "src/checkout.ts#charge",
            affected: [
              { symbol: "src/checkout.ts#charge", file: "src/checkout.ts", relation: "root", depth: 0, risk: "signature" },
              { symbol: "src/routes/billing.ts#chargeRoute", file: "src/routes/billing.ts", relation: "caller", depth: 1, risk: "signature" },
              { symbol: "src/components/Checkout.tsx#Checkout", file: "src/components/Checkout.tsx", relation: "caller", depth: 1, risk: "behavior" },
            ],
            blast_radius: { files: 3, symbols: 3, crosses_branches: true },
            truncated: false,
          },
          grounding: ["src/checkout.ts#charge", "src/components/Checkout.tsx#Checkout"],
          fallback_text: "charge() change in checkout.ts crosses the api and web branches (shared file).",
        },
      ],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
    {
      // infra node → resource_diagram
      node_id: uuid("g3n5"),
      revision: 1,
      assumptions: [{ text: "The billing service runs as its own container behind the internal gateway.", grounded_refs: ["infra/billing.tf"], confidence: 0.72 }],
      analysis: [{ kind: "failure_mode", text: "Without a queue DLQ, a poisoned charge event blocks the whole worker.", grounded_refs: ["infra/billing.tf"], severity: "medium", confidence: 0.7 }],
      benefits: [{ text: "Billing scales and deploys independently of the monolith.", grounded_refs: ["infra/billing.tf"] }],
      notable_symbols: [{ symbol: "BILLING_SVC_URL", file: "infra/billing.tf", role: "config", why_notable: "The address every billing caller resolves." }],
      widget_specs: [
        {
          widget: "resource_diagram",
          version: 1,
          props: {
            resources: [
              { id: "gw", name: "internal-gateway", kind: "gateway", change: "modified" },
              { id: "svc", name: "billing-service", kind: "service", change: "added" },
              { id: "q", name: "billing-events", kind: "queue", change: "added" },
              { id: "db", name: "billing-db", kind: "database", change: "added" },
            ],
            links: [
              { from: "gw", to: "svc", label: "routes /billing" },
              { from: "svc", to: "q", label: "publishes charges" },
              { from: "svc", to: "db", label: "ledger writes" },
            ],
          },
          grounding: ["infra/billing.tf", "BILLING_SVC_URL"],
          fallback_text: "Adds billing-service + billing-events queue + billing-db behind the internal gateway.",
        },
      ],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
    {
      // test node → checklist + test_linkage (multi-widget composition)
      node_id: uuid("g3n6"),
      revision: 1,
      assumptions: [{ text: "The e2e suite can run against the merged worktree before promotion.", grounded_refs: ["test/billing.e2e.ts"], confidence: 0.75 }],
      analysis: [{ kind: "race_condition", text: "Integration must serialize the api and web lanes — they share src/checkout.ts.", grounded_refs: ["src/checkout.ts"], severity: "high", confidence: 0.83 }],
      benefits: [{ text: "Catches cross-service breakage before the legacy path is removed.", grounded_refs: ["test/billing.e2e.ts"] }],
      notable_symbols: [{ symbol: "billing.e2e", file: "test/billing.e2e.ts", role: "suite", why_notable: "The gate that reconverges every lane." }],
      widget_specs: [
        {
          widget: "checklist",
          version: 1,
          props: {
            title: "integration gate",
            items: [
              { label: "Merge db lane", state: "done", detail: "ledger schema migrated" },
              { label: "Merge api lane", state: "active", detail: "client + routes" },
              { label: "Merge web lane (serialize: shares checkout.ts)", state: "blocked", detail: "waits on api lane" },
              { label: "Run cross-service e2e suite", state: "todo" },
              { label: "Promote merge commit", state: "todo" },
            ],
          },
          grounding: ["test/billing.e2e.ts", "src/checkout.ts"],
          fallback_text: "Integration steps: merge db (done), api (active), web (blocked), run e2e, promote.",
        },
        {
          widget: "test_linkage",
          version: 1,
          props: {
            links: [
              { test: "charges an order end-to-end", file: "test/billing.e2e.ts", covers: ["src/checkout.ts#charge", "src/routes/billing.ts#chargeRoute"], status: "new" },
              { test: "rejects a declined card", file: "test/billing.e2e.ts", covers: ["src/billing/client.ts#BillingClient"], status: "new" },
            ],
            uncovered: ["src/components/Checkout.tsx#Checkout"],
          },
          grounding: ["test/billing.e2e.ts", "src/checkout.ts#charge"],
          fallback_text: "New e2e tests cover charge + decline; Checkout.tsx still uncovered.",
        },
      ],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
    {
      // refactor node → call_graph_impact + markdown rationale (multi-widget composition)
      node_id: uuid("g3n7"),
      revision: 1,
      assumptions: [{ text: "No caller reaches legacyCharge once routes point at the billing client.", grounded_refs: ["src/legacy/billing.ts#legacyCharge"], confidence: 0.66 }],
      analysis: [{ kind: "edge_case", text: "A feature flag may still route a fraction of traffic to legacyCharge.", grounded_refs: ["src/legacy/billing.ts#legacyCharge"], severity: "medium", confidence: 0.6 }],
      benefits: [{ text: "Deletes a duplicated charge path and its drift risk.", grounded_refs: ["src/legacy/billing.ts#legacyCharge"] }],
      notable_symbols: [{ symbol: "legacyCharge", file: "src/legacy/billing.ts", role: "removed", why_notable: "The in-monolith path being retired." }],
      widget_specs: [
        {
          widget: "call_graph_impact",
          version: 1,
          props: {
            root: "src/legacy/billing.ts#legacyCharge",
            affected: [{ symbol: "src/legacy/billing.ts#legacyCharge", file: "src/legacy/billing.ts", relation: "root", depth: 0, risk: "behavior" }],
            blast_radius: { files: 1, symbols: 1, crosses_branches: false },
            truncated: false,
          },
          grounding: ["src/legacy/billing.ts#legacyCharge"],
          fallback_text: "legacyCharge has no remaining callers after the route rewire.",
        },
        {
          widget: "markdown",
          version: 1,
          props: {
            title: "removal rationale",
            markdown:
              "## Why remove `legacyCharge`\nThe monolith charge path is **superseded** by `BillingClient`.\n\n- routes now call the service client\n- the ledger lives in `billing.ledger`\n\nGate removal on the integration suite passing.",
          },
          grounding: ["src/legacy/billing.ts#legacyCharge", "src/billing/client.ts#BillingClient"],
          fallback_text: "legacyCharge is superseded by BillingClient; remove after the integration suite is green.",
        },
      ],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
    {
      // ui_component node → composed (Change 3: a body assembled from primitive blocks)
      node_id: uuid("g3n4"),
      revision: 1,
      assumptions: [{ text: "Checkout consumes the new charge() result shape from the billing client.", grounded_refs: ["src/components/Checkout.tsx#Checkout", "src/checkout.ts"], confidence: 0.74 }],
      analysis: [{ kind: "edge_case", text: "The retry path must handle a pending charge that later succeeds to avoid double-charging.", grounded_refs: ["src/components/Checkout.tsx#Checkout"], severity: "medium", confidence: 0.7 }],
      benefits: [{ text: "Surfaces the receipt URL inline instead of a follow-up fetch.", grounded_refs: ["src/components/Checkout.tsx#Checkout"] }],
      notable_symbols: [{ symbol: "Checkout", file: "src/components/Checkout.tsx", role: "component", why_notable: "Consumes the new charge result; shares checkout.ts with the api lane." }],
      widget_specs: [
        {
          widget: "composed",
          version: 1,
          props: {
            title: "checkout change summary",
            blocks: [
              { kind: "stat", label: "files touched", value: "2", tone: "neutral" },
              { kind: "stat", label: "shared with api lane", value: "checkout.ts", delta: "conflict risk", tone: "neg" },
              { kind: "text", body: "Checkout now consumes the new charge() result shape from BillingClient and renders the receipt inline.", emphasis: "info" },
              { kind: "diff_row", label: "charge() result", before: "{ ok: boolean }", after: "{ status, receiptUrl }", status: "changed" },
              { kind: "table", caption: "props", columns: ["prop", "type", "change"], rows: [["result", "ChargeResult", "changed"], ["onRetry", "() => void", "added"]] },
              { kind: "tree", nodes: [{ label: "Checkout", depth: 0, detail: "component" }, { label: "useCharge()", depth: 1 }, { label: "BillingClient.charge", depth: 2, detail: "new seam" }] },
              { kind: "timeline", steps: [{ label: "wire new result shape", state: "done" }, { label: "update retry UX", state: "active" }, { label: "visual QA", state: "todo" }] },
            ],
          },
          grounding: ["src/components/Checkout.tsx#Checkout", "src/checkout.ts"],
          fallback_text: "Checkout UI updated for the new charge() result shape; shares checkout.ts with the api lane.",
        },
      ],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
  ],
};

// ============================================================================
// G4 — Mega · Hierarchical map (clustered super-nodes)
// ============================================================================

const G4 = "g4mega00-0000-4000-8000-000000000004";

const g4: PlanGraph = {
  plan: {
    id: G4,
    project_id: PROJECT_ID,
    title: "Build analytics platform",
    prompt: "Build an end-to-end analytics platform: ingestion, storage, query API, dashboard.",
    granularity: "g4_mega",
    status: "planning",
    base_commit: "a1b2c3d",
    current_revision: 1,
    layout_spec: {
      tier: "g4_mega",
      canvas: "hierarchical_map",
      direction: "LR",
      grouping: "by_milestone",
      emphasis: ["navigation", "delegation"],
      parallelism_ui: "assign_clusters",
      delegation_ui: "assign_clusters",
      semantic_zoom: true,
      default_inspector_tab: "changes",
    },
    created_by: uuid("user1"),
    created_at: now,
    updated_at: now,
  },
  nodes: [
    cluster("g4c1", G4, "Ingestion", "infra", "running", 12, "Collectors, queue, schema registry.", { built: 4, ready: 8 }),
    cluster("g4c2", G4, "Storage", "migration", "ready", 9, "Columnar store + partitioning.", { built: 0, ready: 9 }),
    cluster("g4c3", G4, "Query API", "api_contract", "pending", 15, "Aggregation API + caching layer.", { built: 0, ready: 15 }),
    cluster("g4c4", G4, "Dashboard", "ui_component", "pending", 18, "Charts, filters, sharing.", { built: 0, ready: 18 }),
  ],
  edges: [
    edge("g4e1", G4, "g4c1", "g4c2", "data_flow", "Ingestion writes to storage.", { reason: "data_flow", shared: ["events"], from_provides: ["events"], to_consumes: ["events"], overlap_score: 0 }),
    edge("g4e2", G4, "g4c2", "g4c3", "data_flow", "Query API reads storage.", { reason: "data_flow", shared: ["events"], from_provides: ["events"], to_consumes: ["events"], overlap_score: 0 }),
    edge("g4e3", G4, "g4c3", "g4c4", "data_flow", "Dashboard calls the query API.", { reason: "symbol_dependency", shared: ["QueryClient"], from_provides: ["QueryClient"], to_consumes: ["QueryClient"], overlap_score: 0 }),
  ],
  branches: [
    { id: uuid("g4b1"), plan_id: G4, label: "Ingestion", node_ids: [uuid("g4c1")], status: "running", assignee_user_id: uuid("user1"), worktree_path: null, independent_of: [] },
    { id: uuid("g4b2"), plan_id: G4, label: "Storage", node_ids: [uuid("g4c2")], status: "ready", assignee_user_id: uuid("user2"), worktree_path: null, independent_of: [] },
    { id: uuid("g4b3"), plan_id: G4, label: "Query API", node_ids: [uuid("g4c3")], status: "ready", assignee_user_id: null, worktree_path: null, independent_of: [] },
    { id: uuid("g4b4"), plan_id: G4, label: "Dashboard", node_ids: [uuid("g4c4")], status: "ready", assignee_user_id: null, worktree_path: null, independent_of: [] },
  ],
  annotations: [
    {
      node_id: uuid("g4c2"),
      revision: 1,
      assumptions: [{ text: "Event volume justifies a columnar store over the OLTP db.", grounded_refs: [], confidence: 0.5 }],
      analysis: [{ kind: "perf", text: "Partition by day to keep query scans bounded.", grounded_refs: ["storage/partition.ts"], severity: "medium", confidence: 0.66 }],
      benefits: [{ text: "Sub-second aggregate queries at billions of rows.", grounded_refs: ["storage/partition.ts"] }],
      notable_symbols: [{ symbol: "Partitioner", file: "storage/partition.ts", role: "module", why_notable: "Governs scan cost for every dashboard query." }],
      widget_specs: [],
      model: "claude-sonnet-4-6",
      generated_at: now,
    },
  ],
};

// ---- helpers ----

interface ResolvedHint {
  files?: string[];
  symbols?: string[];
  signatures_changed?: string[];
  schema_keys?: string[];
  config_keys?: string[];
}

function mk(
  seed: string,
  planId: string,
  title: string,
  change_type: PlanGraph["nodes"][number]["change_type"],
  status: PlanGraph["nodes"][number]["status"],
  branch_id: string,
  summary: string,
  resolved: ResolvedHint,
): PlanGraph["nodes"][number] {
  return {
    id: uuid(seed),
    plan_id: planId,
    revision: 1,
    title,
    change_type,
    granularity: "g2_meso",
    status,
    summary,
    touch_set: {
      predicted: {
        add: (resolved.symbols ?? []).slice(0, 1).map((s) => ({ kind: "symbol", name: s.split("#").pop() ?? s, file: s.split("#")[0] })),
        modify: [],
        delete: [],
      },
      resolved: {
        files: resolved.files ?? [],
        symbols: resolved.symbols ?? [],
        signatures_changed: resolved.signatures_changed ?? [],
        schema_keys: resolved.schema_keys ?? [],
        config_keys: resolved.config_keys ?? [],
      },
      resolution_confidence: 0.85,
    },
    position: { x: 0, y: 0 },
    branch_id,
    parent_node_id: null,
    worktree_ref: null,
    diff_artifact_path: null,
    confidence: 0.8,
  };
}

function mkLane(
  seed: string,
  planId: string,
  title: string,
  change_type: PlanGraph["nodes"][number]["change_type"],
  status: PlanGraph["nodes"][number]["status"],
  branch_id: string,
  _module: string,
  summary: string,
  resolved: ResolvedHint,
): PlanGraph["nodes"][number] {
  const node = mk(seed, planId, title, change_type, status, branch_id, summary, resolved);
  return { ...node, granularity: "g3_macro" };
}

function cluster(
  seed: string,
  planId: string,
  title: string,
  change_type: PlanGraph["nodes"][number]["change_type"],
  status: PlanGraph["nodes"][number]["status"],
  childCount: number,
  summary: string,
  rollup: { built: number; ready: number },
): PlanGraph["nodes"][number] {
  return {
    id: uuid(seed),
    plan_id: planId,
    revision: 1,
    title: `${title} (${childCount} nodes · ${rollup.built} built / ${rollup.ready} ready)`,
    change_type,
    granularity: "g4_mega",
    status,
    summary,
    touch_set: { predicted: { add: [], modify: [], delete: [] }, resolution_confidence: 0.6 },
    position: { x: 0, y: 0 },
    branch_id: null,
    parent_node_id: null,
    worktree_ref: null,
    diff_artifact_path: null,
    confidence: 0.6,
  };
}

function edge(
  seed: string,
  planId: string,
  fromSeed: string,
  toSeed: string,
  type: PlanGraph["edges"][number]["type"],
  rationale: string,
  evidence: PlanGraph["edges"][number]["evidence"],
): PlanGraph["edges"][number] {
  return {
    id: uuid(seed),
    plan_id: planId,
    revision: 1,
    from_node: uuid(fromSeed),
    to_node: uuid(toSeed),
    type,
    rationale,
    evidence,
    overlap_score: evidence.overlap_score,
  };
}

export const FIXTURE_PLANS: Record<string, PlanGraph> = {
  [g1.plan.id]: g1,
  [g2.plan.id]: g2,
  [g3.plan.id]: g3,
  [g4.plan.id]: g4,
};

export const FIXTURE_PROJECT: ProjectListItem = {
  id: PROJECT_ID,
  name: "acme-app",
  repo_url: "github.com/acme/app",
  default_branch: "main",
  languages: ["typescript", "sql"],
  plan_count: 4,
  updated_at: now,
};

export const FIXTURE_PLAN_LIST: PlanListItem[] = [g2, g3, g1, g4].map((g) => ({
  id: g.plan.id,
  project_id: g.plan.project_id,
  title: g.plan.title,
  prompt: g.plan.prompt,
  granularity: g.plan.granularity,
  status: g.plan.status,
  node_count: g.nodes.length,
  updated_at: g.plan.updated_at,
}));

export function getFixturePlan(id: string): PlanGraph | null {
  return FIXTURE_PLANS[id] ?? null;
}

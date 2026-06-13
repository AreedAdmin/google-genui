/**
 * Centralized environment access for the worker process.
 *
 * Mirrors apps/api/src/env.ts conventions: optional() with code-baked defaults,
 * required() only where a missing value is genuinely fatal. The MVP is built to
 * *degrade* (missing repo / analysis service / Claude Code => stub + log), so
 * almost everything here has a fallback; only ANTHROPIC_API_KEY and Supabase
 * creds are hard-required at the point of use.
 */

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function optionalNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  logLevel: optional("LOG_LEVEL", "info"),
  get isDev(): boolean {
    return this.nodeEnv === "development";
  },

  // Redis / queues
  redisUrl: optional("REDIS_URL", "redis://localhost:6379"),

  // Supabase (required lazily by @trellis/db createAdminClient)
  supabaseUrl: optional("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321"),

  // Anthropic
  anthropicApiKey: optional("ANTHROPIC_API_KEY", ""),
  plannerModel: optional("PLANNER_MODEL", "claude-opus-4-8"),
  analysisModel: optional("ANALYSIS_MODEL", "claude-opus-4-8"),
  widgetModel: optional("WIDGET_MODEL", "claude-sonnet-4-6"),

  // Analysis service
  analysisServiceUrl: optional("ANALYSIS_SERVICE_URL", "http://localhost:8000"),

  // Execution / runners
  executionBackend: optional("EXECUTION_BACKEND", "claude_code"),
  claudeCodePath: optional("CLAUDE_CODE_PATH", "/usr/local/bin/claude"),
  claudeCodeModel: optional("CLAUDE_CODE_MODEL", "claude-sonnet-4-6"),
  claudeCodePermissionMode: optional("CLAUDE_CODE_PERMISSION_MODE", "acceptEdits"),
  claudeCodeMaxTurns: optionalNum("CLAUDE_CODE_MAX_TURNS", 40),
  worktreeRoot: optional("WORKTREE_ROOT", "/var/trellis/worktrees"),
  maxConcurrentBranches: optionalNum("MAX_CONCURRENT_BRANCHES", 4),

  // Repo access
  githubToken: optional("GITHUB_TOKEN", ""),
  // Where cloned repos are cached on the worker host.
  repoCacheRoot: optional("REPO_CACHE_ROOT", "/var/trellis/repos"),
};

export type Env = typeof env;

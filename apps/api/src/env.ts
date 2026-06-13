/**
 * Centralized environment access. Reads from process.env (loaded by the host,
 * docker-compose, or a `.env` via the runtime). Throws early for required vars
 * so misconfiguration fails at boot, not mid-request.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  get isDev(): boolean {
    return this.nodeEnv === "development";
  },
  apiPort: Number(optional("API_PORT", "8080")),
  mcpPort: Number(optional("MCP_SERVER_PORT", "8090")),
  redisUrl: optional("REDIS_URL", "redis://localhost:6379"),
  corsOrigins: optional("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  appUrl: optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
  // Lazily required (only when auth actually runs).
  jwtSecret: (): string => required("SUPABASE_JWT_SECRET"),
  mcpTokenSecret: (): string => required("TRELLIS_MCP_TOKEN_SECRET"),
};

/** Fixed dev identity used when NODE_ENV=development and no JWT is supplied. */
export const DEV_IDENTITY = {
  userId: "00000000-0000-0000-0000-000000000001",
  orgId: "00000000-0000-0000-0000-000000000010",
  email: "dev@trellis.local",
} as const;

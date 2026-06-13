import { createAdminClient, type SupabaseClient } from "@trellis/db";

/**
 * Single service-role Supabase client for the whole worker process. Service role
 * bypasses RLS; every write here is already scoped by plan_id / project_id /
 * node_id because the worker is a trusted server (security-and-auth.md §3).
 */
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) client = createAdminClient();
  return client;
}

/** Best-effort `events` row. Never throws — observability must not break a job. */
export async function recordEvent(
  planId: string | null,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db().from("events").insert({ plan_id: planId, type, payload });
  } catch {
    /* swallow — events are best-effort */
  }
}

export type { SupabaseClient };

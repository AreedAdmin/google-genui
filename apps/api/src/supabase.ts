import { createAdminClient, type SupabaseClient } from "@trellis/db";

/**
 * Single service-role Supabase client for the whole API process. The service
 * role bypasses RLS, so every query in src/services/ MUST scope by the
 * caller's ids (org_id / plan_id / project_id) explicitly.
 */
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) client = createAdminClient();
  return client;
}

export type { SupabaseClient };

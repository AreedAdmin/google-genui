import type { ShareRequest } from "@trellis/shared";
import type { Identity } from "../auth.js";
import { db } from "../supabase.js";

/** Shares service — grant a principal access to a plan/project (RLS-backed). */
export async function createShare(identity: Identity, input: ShareRequest) {
  const { data, error } = await db()
    .from("shares")
    .insert({
      resource_type: input.resource_type,
      resource_id: input.resource_id,
      principal_user: input.principal_user ?? null,
      principal_email: input.principal_email ?? null,
      role: input.role,
      created_by: identity.userId,
    })
    .select("*")
    .single();

  if (error) throw new Error(`createShare failed: ${error.message}`);
  return data;
}

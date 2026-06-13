import type { Identity } from "../auth.js";
import { db } from "../supabase.js";

/**
 * Project service — create + list projects. In dev the default org/user come
 * from the caller's identity (the seeded dev org/profile). Production callers
 * carry a real org from their JWT.
 */

export interface CreateProjectInput {
  name: string;
  repo_url: string;
  provider?: string;
  default_branch?: string;
  languages?: string[];
}

export async function createProject(identity: Identity, input: CreateProjectInput) {
  const { data, error } = await db()
    .from("projects")
    .insert({
      org_id: identity.orgId,
      name: input.name,
      repo_url: input.repo_url,
      provider: input.provider ?? "github",
      default_branch: input.default_branch ?? "main",
      languages: input.languages ?? [],
      created_by: identity.userId,
    })
    .select("*")
    .single();

  if (error) throw new Error(`createProject failed: ${error.message}`);
  return data;
}

/** List projects scoped to the caller's org. */
export async function listProjects(identity: Identity) {
  const { data, error } = await db()
    .from("projects")
    .select("*")
    .eq("org_id", identity.orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listProjects failed: ${error.message}`);
  return data ?? [];
}

/** Fetch a project the caller may access (org-scoped). Returns null if absent. */
export async function getProject(identity: Identity, projectId: string) {
  const { data, error } = await db()
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("org_id", identity.orgId)
    .maybeSingle();

  if (error) throw new Error(`getProject failed: ${error.message}`);
  return data;
}

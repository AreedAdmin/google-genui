/**
 * Pre-flight validation for connecting a repository (Phase 1 / repo-connection).
 * Confirms the repo URL + branch are actually reachable BEFORE we persist a
 * project — otherwise plan-build would silently degrade to the sample repo and
 * the user would think they connected real code when they hadn't.
 *
 * GitHub-aware (the default provider): uses the public GitHub REST API with the
 * optional GITHUB_TOKEN for private repos. For non-GitHub / unparseable URLs we
 * skip (allow) and let the worker's clone + fallback handle it.
 */

export interface RepoValidation {
  ok: boolean;
  /** True when we couldn't validate (non-GitHub URL / network) and chose to allow. */
  skipped?: boolean;
  private?: boolean;
  /** The repo's real default branch (used to default the project's branch). */
  defaultBranch?: string;
  /** The branch we verified exists. */
  resolvedBranch?: string;
  error?: string;
}

function parseGitHub(url: string): { owner: string; repo: string } | null {
  // Handles https://github.com/owner/repo(.git)(/…) and git@github.com:owner/repo.git
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  if (!m || !m[1] || !m[2]) return null;
  return { owner: m[1], repo: m[2] };
}

async function ghFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "trellis",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token && !/replace-with/i.test(token)) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    return await fetch(`https://api.github.com${path}`, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function validateRepoConnection(
  repoUrl: string,
  branch?: string | null,
): Promise<RepoValidation> {
  const gh = parseGitHub(repoUrl);
  // Not a GitHub URL we can introspect — allow; the worker clone has a fallback.
  if (!gh) return { ok: true, skipped: true };

  try {
    const repoRes = await ghFetch(`/repos/${gh.owner}/${gh.repo}`);
    if (repoRes.status === 404) {
      return { ok: false, error: "Repository not found. If it's private, set GITHUB_TOKEN in .env." };
    }
    if (repoRes.status === 401 || repoRes.status === 403) {
      return { ok: false, error: "Access denied to the repository — check GITHUB_TOKEN scopes (or GitHub API rate limit)." };
    }
    if (!repoRes.ok) {
      return { ok: false, error: `GitHub returned ${repoRes.status} for ${gh.owner}/${gh.repo}.` };
    }

    const repo = (await repoRes.json()) as { default_branch?: string; private?: boolean };
    const wanted = (branch && branch.trim()) || repo.default_branch || "main";

    const brRes = await ghFetch(`/repos/${gh.owner}/${gh.repo}/branches/${encodeURIComponent(wanted)}`);
    if (brRes.status === 404) {
      return { ok: false, error: `Branch "${wanted}" not found in ${gh.owner}/${gh.repo}.` };
    }
    if (!brRes.ok) {
      return { ok: false, error: `Couldn't verify branch "${wanted}" (GitHub ${brRes.status}).` };
    }

    return {
      ok: true,
      private: !!repo.private,
      defaultBranch: repo.default_branch ?? wanted,
      resolvedBranch: wanted,
    };
  } catch (err) {
    // Network/timeout — don't hard-block connecting; the worker will try to clone
    // and degrade gracefully if it can't.
    return { ok: true, skipped: true, error: (err as Error).message };
  }
}

export interface AccessibleRepo {
  full_name: string;
  name: string;
  owner: string;
  url: string;
  default_branch: string;
  private: boolean;
  description: string | null;
  language: string | null;
  updated_at: string;
}

/**
 * List repositories the configured GITHUB_TOKEN can access (owner + collaborator
 * + org member), most-recently-updated first — to populate the connect-repo
 * dropdown. Returns { authenticated: false } when no token is set.
 */
export async function listAccessibleRepos(
  limit = 100,
): Promise<{ authenticated: boolean; repos: AccessibleRepo[] }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || /replace-with/i.test(token)) return { authenticated: false, repos: [] };
  try {
    const res = await ghFetch(
      "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    );
    if (!res.ok) return { authenticated: true, repos: [] };
    const data = (await res.json()) as Array<{
      full_name: string;
      name: string;
      owner?: { login?: string };
      html_url: string;
      default_branch?: string;
      private?: boolean;
      description?: string | null;
      language?: string | null;
      updated_at: string;
    }>;
    const repos: AccessibleRepo[] = data.slice(0, limit).map((r) => ({
      full_name: r.full_name,
      name: r.name,
      owner: r.owner?.login ?? "",
      url: r.html_url,
      default_branch: r.default_branch ?? "main",
      private: !!r.private,
      description: r.description ?? null,
      language: r.language ?? null,
      updated_at: r.updated_at,
    }));
    return { authenticated: true, repos };
  } catch {
    return { authenticated: true, repos: [] };
  }
}

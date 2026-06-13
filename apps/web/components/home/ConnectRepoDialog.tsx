"use client";

import * as React from "react";
import { Github, Lock, Search, Check } from "lucide-react";
import { Dialog } from "@/components/ui/overlay";
import { Button } from "@/components/ui/primitives";
import { useCreateProject, useGithubRepos } from "@/lib/hooks";
import type { ProjectListItem } from "@/lib/api";

const inputCls =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-fg-muted">{hint}</span>}
    </label>
  );
}

function deriveName(url: string): string {
  const m = url.match(/github\.com[/:][^/]+\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return m?.[1] ?? "";
}

/**
 * Connect a GitHub repository as a Trellis project. Primary path: pick from the
 * repos the configured GITHUB_TOKEN can access (searchable dropdown). Fallback:
 * paste any URL. The server validates the repo + branch (GitHub API) before
 * saving, so a bad choice fails here rather than degrading to the sample repo at
 * plan-build. On success the new project becomes the active repo context.
 */
export function ConnectRepoDialog({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: (project: ProjectListItem) => void;
}) {
  const { data: gh } = useGithubRepos();
  const repos = gh?.repos ?? [];
  const authed = gh?.authenticated ?? false;

  const [repoUrl, setRepoUrl] = React.useState("");
  const [name, setName] = React.useState("");
  const [branch, setBranch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const create = useCreateProject();

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? repos.filter((r) => r.full_name.toLowerCase().includes(q)) : repos;
    return list.slice(0, 8);
  }, [repos, query]);

  function pick(url: string, repoName: string, defaultBranch: string) {
    setRepoUrl(url);
    setName(repoName);
    setBranch(defaultBranch);
    setError(null);
  }

  function reset() {
    setRepoUrl("");
    setName("");
    setBranch("");
    setQuery("");
    setError(null);
  }

  function submit() {
    const url = repoUrl.trim();
    if (!url) return;
    setError(null);
    create.mutate(
      { name: name.trim() || deriveName(url) || url, repo_url: url, default_branch: branch.trim() || undefined },
      {
        onSuccess: (project) => {
          onConnected(project);
          reset();
          onClose();
        },
        onError: (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't connect the repository."),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect a repository"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!repoUrl.trim()}
            icon={<Github size={14} />}
            onClick={submit}
          >
            Connect
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <p className="text-xs text-fg-muted">
          Trellis clones and indexes this repo so the planner and agents reason over your{" "}
          <strong className="text-fg">real code</strong> — files, symbols, and conventions ground the plan, the
          nodes, and the assumptions/risks/benefits.
        </p>

        {authed && repos.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">Pick from your GitHub</span>
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-fg-muted" aria-hidden />
              <input
                className={`${inputCls} pl-7`}
                placeholder="Search your repositories…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="max-h-44 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-xs text-fg-muted">No matching repositories.</p>
              ) : (
                filtered.map((r) => {
                  const selected = r.url === repoUrl;
                  return (
                    <button
                      key={r.full_name}
                      type="button"
                      onClick={() => pick(r.url, r.name, r.default_branch)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                        selected ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]" : "hover:bg-surface-2"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {r.private ? (
                          <Lock size={11} className="shrink-0 text-fg-muted" aria-label="private" />
                        ) : (
                          <Github size={11} className="shrink-0 text-fg-muted" aria-hidden />
                        )}
                        <span className="truncate font-medium text-fg">{r.full_name}</span>
                        <span className="shrink-0 text-fg-muted">· {r.default_branch}</span>
                      </span>
                      {selected && <Check size={13} className="shrink-0 text-accent" aria-hidden />}
                    </button>
                  );
                })
              )}
            </div>
            <span className="block text-[11px] text-fg-muted">
              {repos.length} accessible · showing {filtered.length}. Or enter a URL below.
            </span>
          </div>
        )}

        {!authed && (
          <p className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[11px] text-fg-muted">
            Set <code className="text-fg">GITHUB_TOKEN</code> in <code className="text-fg">.env</code> and restart to
            browse your repos — or paste a URL below.
          </p>
        )}

        <Field label="Repository URL" hint="Public repos work as-is. Private repos need GITHUB_TOKEN set in .env.">
          <input
            className={inputCls}
            placeholder="https://github.com/owner/repo"
            value={repoUrl}
            onChange={(e) => {
              const v = e.target.value;
              setRepoUrl(v);
              if (!name) setName(deriveName(v));
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className={inputCls} placeholder="my-repo" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Branch" hint="defaults to the repo's default">
            <input className={inputCls} placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </Field>
        </div>
        {error && <p className="text-xs text-[var(--st-failed)]">{error}</p>}
      </div>
    </Dialog>
  );
}

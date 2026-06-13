"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles, Github, FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/supabase";
import { useProjects } from "@/lib/hooks";
import { ConnectRepoDialog } from "./ConnectRepoDialog";
import { FIXTURE_PROJECT, FIXTURE_PLAN_LIST } from "@/lib/fixtures";

/**
 * The web entry — "Describe what to build". You pick the connected repo to plan
 * against (or connect a new one); submitting POSTs /v1/plans for that project and
 * routes to the canvas at /p/[id]. The chosen repo is what the planner + agents
 * use as grounding context. Falls back to a fixture plan when the API is down so
 * the generative-UI surface is always reachable for the demo.
 */

const SUGGESTIONS = [
  "Add Google + GitHub OAuth login",
  "Extract billing into its own service",
  "Tighten login validation before hashing",
  "Build an end-to-end analytics platform",
];

const LAST_PROJECT_KEY = "trellis.projectId";

export function PromptBox() {
  const router = useRouter();
  const { data: projects = [] } = useProjects();
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [connectOpen, setConnectOpen] = React.useState(false);
  const [prompt, setPrompt] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Initialise the active project from localStorage, else the first connected repo.
  React.useEffect(() => {
    if (projectId && projects.some((p) => p.id === projectId)) return;
    const saved = typeof window !== "undefined" ? localStorage.getItem(LAST_PROJECT_KEY) : null;
    if (saved && projects.some((p) => p.id === saved)) setProjectId(saved);
    else if (projects.length) setProjectId(projects[0]!.id);
  }, [projects, projectId]);

  function selectProject(id: string) {
    setProjectId(id);
    try {
      localStorage.setItem(LAST_PROJECT_KEY, id);
    } catch {
      /* ignore */
    }
  }

  const activeProject = projects.find((p) => p.id === projectId) ?? null;

  async function submit(text: string) {
    const value = text.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const pid = projectId ?? FIXTURE_PROJECT.id;
      const { plan_id } = await api.createPlan({ project_id: pid, prompt: value }, token);
      router.push(`/p/${plan_id}`);
    } catch {
      // Demo fallback: route to the closest fixture plan by keyword.
      const lower = value.toLowerCase();
      const match =
        FIXTURE_PLAN_LIST.find((p) => (lower.includes("oauth") || lower.includes("login")) && p.title.toLowerCase().includes("oauth")) ??
        FIXTURE_PLAN_LIST.find((p) => (lower.includes("billing") || lower.includes("service")) && p.title.toLowerCase().includes("billing")) ??
        FIXTURE_PLAN_LIST.find((p) => (lower.includes("analytic") || lower.includes("platform")) && p.title.toLowerCase().includes("analytics")) ??
        FIXTURE_PLAN_LIST.find((p) => lower.includes("valid") && p.title.toLowerCase().includes("validation")) ??
        FIXTURE_PLAN_LIST[0];
      if (match) {
        router.push(`/p/${match.id}`);
      } else {
        setError("Couldn't reach the planner. Is the API running?");
        setSubmitting(false);
      }
    }
  }

  return (
    <div className="w-full">
      {/* Repo context picker — what the agents read as grounding */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 text-fg-muted">
          <FolderGit2 size={13} aria-hidden /> Repo context:
        </span>
        {projects.length > 0 ? (
          <select
            value={projectId ?? ""}
            onChange={(e) => selectProject(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            aria-label="Repository to plan against"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.default_branch}
              </option>
            ))}
          </select>
        ) : (
          <span className="italic text-fg-muted">none connected — plans use a sample repo</span>
        )}
        <button
          onClick={() => setConnectOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg"
        >
          <Github size={13} aria-hidden /> Connect a repo
        </button>
        {activeProject && (
          <span className="truncate text-fg-muted" title={activeProject.repo_url}>
            agents read this repo&apos;s real code
          </span>
        )}
      </div>

      <div className="relative rounded-2xl border border-border bg-surface p-1.5 shadow-card transition-shadow focus-within:shadow-pop focus-within:ring-2 focus-within:ring-[var(--ring)]">
        <div className="flex items-start gap-2 px-3 pt-3">
          <Sparkles size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(prompt);
            }}
            rows={2}
            placeholder="Describe what to build — Trellis turns it into a grounded plan you can run, branch, and delegate."
            className="min-h-[52px] w-full resize-none bg-transparent text-[15px] text-fg placeholder:text-fg-muted focus-visible:outline-none"
            aria-label="Describe what to build"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-1">
          <span className="text-[11px] text-fg-muted">⌘↵ to plan</span>
          <Button variant="primary" onClick={() => submit(prompt)} loading={submitting} disabled={!prompt.trim()} icon={!submitting ? <ArrowRight size={15} /> : undefined}>
            Plan it
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setPrompt(s);
              submit(s);
            }}
            className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg"
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-[var(--st-failed)]">{error}</p>}

      <ConnectRepoDialog open={connectOpen} onClose={() => setConnectOpen(false)} onConnected={(p) => selectProject(p.id)} />
    </div>
  );
}

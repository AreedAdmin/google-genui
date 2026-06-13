"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/supabase";
import { FIXTURE_PROJECT, FIXTURE_PLAN_LIST } from "@/lib/fixtures";

/**
 * The web entry — "Describe what to build". Submitting POSTs /v1/plans and
 * routes to the canvas at /p/[id]. Falls back to a fixture plan when the API is
 * unreachable so the generative-UI surface is always reachable for the demo.
 */

const SUGGESTIONS = [
  "Add Google + GitHub OAuth login",
  "Extract billing into its own service",
  "Tighten login validation before hashing",
  "Build an end-to-end analytics platform",
];

export function PromptBox() {
  const router = useRouter();
  const [prompt, setPrompt] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(text: string) {
    const value = text.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const { id } = await api.createPlan({ project_id: FIXTURE_PROJECT.id, prompt: value }, token);
      router.push(`/p/${id}`);
    } catch {
      // Demo fallback: route to the closest fixture plan by keyword.
      const lower = value.toLowerCase();
      const match =
        FIXTURE_PLAN_LIST.find((p) => lower.includes("oauth") || lower.includes("login") ? p.title.toLowerCase().includes("oauth") : false) ??
        FIXTURE_PLAN_LIST.find((p) => lower.includes("billing") || lower.includes("service") ? p.title.toLowerCase().includes("billing") : false) ??
        FIXTURE_PLAN_LIST.find((p) => lower.includes("analytic") || lower.includes("platform") ? p.title.toLowerCase().includes("analytics") : false) ??
        FIXTURE_PLAN_LIST.find((p) => lower.includes("valid") ? p.title.toLowerCase().includes("validation") : false) ??
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
    </div>
  );
}

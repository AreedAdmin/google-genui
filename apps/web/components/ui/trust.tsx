"use client";

import * as React from "react";
import { cn, shortRef } from "@/lib/utils";
import { ThumbsUp, ThumbsDown, Link2, ShieldCheck, ShieldAlert } from "lucide-react";
import { useFeedback } from "@/lib/hooks";

/**
 * The trust surface (component-library.md §4): GroundingChip, Citation,
 * ClaimFeedback, LowConfidenceLabel. These render Trellis's honesty principles
 * (genui-philosophy.md §5) — grounding shown, low-confidence labeled, per-claim
 * feedback — consistently across the inspector and every WidgetFrame.
 */

// ---- Citation (a clickable file#symbol token) ----

export function Citation({ refStr, onJump }: { refStr: string; onJump?: (ref: string) => void }) {
  return (
    <button
      onClick={() => onJump?.(refStr)}
      title={refStr}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5",
        "font-mono text-[10.5px] text-fg-muted hover:border-accent hover:text-accent transition-colors",
      )}
    >
      <Link2 size={10} className="shrink-0" aria-hidden />
      <span className="truncate">{shortRef(refStr)}</span>
    </button>
  );
}

export function CitationRow({ refs, onJump }: { refs: string[]; onJump?: (ref: string) => void }) {
  if (!refs.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {refs.map((r, i) => (
        <Citation key={`${r}-${i}`} refStr={r} onJump={onJump} />
      ))}
    </div>
  );
}

// ---- GroundingChip — "grounded · N refs · 0.86" expandable ----

export function GroundingChip({
  refs,
  confidence,
  onJump,
}: {
  refs: string[];
  confidence?: number;
  onJump?: (ref: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const grounded = refs.length > 0;
  const low = confidence !== undefined && confidence < 0.5;

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors",
          grounded
            ? "border-[color-mix(in_srgb,var(--st-built)_40%,var(--border))] text-[var(--st-built)]"
            : "border-[color-mix(in_srgb,var(--st-blocked)_40%,var(--border))] text-[var(--st-blocked)]",
        )}
        aria-expanded={open}
      >
        {grounded ? <ShieldCheck size={11} aria-hidden /> : <ShieldAlert size={11} aria-hidden />}
        <span>{grounded ? "grounded" : "ungrounded"}</span>
        {grounded && <span className="text-fg-muted">· {refs.length} refs</span>}
        {confidence !== undefined && <span className={cn("tabular-nums", low ? "text-[var(--st-blocked)]" : "text-fg-muted")}>· {confidence.toFixed(2)}</span>}
        <span className="text-fg-muted">▾</span>
      </button>
      {open && grounded && (
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-surface p-2 shadow-pop">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Cited symbols</p>
          <div className="flex flex-wrap gap-1">
            {refs.map((r, i) => (
              <Citation key={`${r}-${i}`} refStr={r} onJump={onJump} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- LowConfidenceLabel ----

export function LowConfidenceLabel() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-[color-mix(in_srgb,var(--st-blocked)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--st-blocked)]">
      <ShieldAlert size={10} aria-hidden /> low-confidence
    </span>
  );
}

// ---- ClaimFeedback (per-claim 👍/👎 → POST feedback, optimistic) ----

export function ClaimFeedback({ nodeId, annotationPath }: { nodeId: string; annotationPath: string }) {
  const [vote, setVote] = React.useState<"up" | "down" | null>(null);
  const feedback = useFeedback();

  const cast = (v: "up" | "down") => {
    const next = vote === v ? null : v;
    setVote(next); // optimistic
    if (next) feedback.mutate({ node_id: nodeId, annotation_path: annotationPath, vote: next });
  };

  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        onClick={() => cast("up")}
        aria-label="Helpful"
        aria-pressed={vote === "up"}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-surface-2",
          vote === "up" ? "text-[var(--st-built)]" : "text-fg-muted",
        )}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        onClick={() => cast("down")}
        aria-label="Not helpful"
        aria-pressed={vote === "down"}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-surface-2",
          vote === "down" ? "text-[var(--st-failed)]" : "text-fg-muted",
        )}
      >
        <ThumbsDown size={12} />
      </button>
    </span>
  );
}

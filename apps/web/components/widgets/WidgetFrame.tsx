"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { GroundingChip } from "@/components/ui/trust";
import { AlertTriangle } from "lucide-react";

/**
 * The shared widget chrome (widget-generation.md §3). NO widget renders without
 * a frame, so the grounding signal is structurally guaranteed (honesty
 * constraint). Draws the title, the grounding chip (expands to cited symbols),
 * and a low-confidence banner.
 */

export function WidgetFrame({
  title,
  icon,
  grounding,
  confidence,
  onJump,
  children,
  ariaLabel,
}: {
  title: string;
  icon?: React.ReactNode;
  grounding: string[];
  confidence?: number;
  onJump?: (ref: string) => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const low = confidence !== undefined && confidence < 0.5;
  return (
    <figure
      aria-label={ariaLabel ?? title}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <figcaption className="flex items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-fg">
          {icon}
          <span className="truncate">{title}</span>
        </span>
        <GroundingChip refs={grounding} confidence={confidence} onJump={onJump} />
      </figcaption>
      {low && (
        <div className="flex items-center gap-1.5 border-b border-border bg-[color-mix(in_srgb,var(--st-blocked)_10%,transparent)] px-3 py-1.5 text-[11px] text-[var(--st-blocked)]">
          <AlertTriangle size={12} aria-hidden />
          Low-confidence widget — render is illustrative until the build grounds it.
        </div>
      )}
      <div className="p-3">{children}</div>
    </figure>
  );
}

/**
 * FallbackWidget (widget-generation.md §3). Renders sanitized plain text inside
 * a muted panel — the plan is never broken by a bad/unknown spec; the worst
 * case is a node showing its text summary.
 */
export function FallbackWidget({
  reason,
  fallbackText,
}: {
  reason: "bad_envelope" | "unknown_widget" | "bad_props" | "oversize";
  fallbackText?: string;
}) {
  const reasonLabel: Record<string, string> = {
    bad_envelope: "malformed spec",
    unknown_widget: "unknown widget",
    bad_props: "invalid props",
    oversize: "oversize props",
  };
  return (
    <figure
      aria-label="widget fallback"
      className="overflow-hidden rounded-lg border border-dashed border-border bg-surface-2/40"
    >
      <figcaption className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px] text-fg-muted">
        <AlertTriangle size={12} aria-hidden />
        Couldn&apos;t render widget ({reasonLabel[reason]}) — showing summary.
      </figcaption>
      <div className="px-3 py-2.5 text-xs text-fg">
        {fallbackText ? <p className="whitespace-pre-wrap">{fallbackText}</p> : <p className="italic text-fg-muted">No summary available.</p>}
      </div>
    </figure>
  );
}

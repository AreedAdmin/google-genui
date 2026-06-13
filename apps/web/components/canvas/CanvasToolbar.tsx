"use client";

import * as React from "react";
import type { LayoutSpec, Granularity } from "@trellis/shared";
import { Button } from "@/components/ui/primitives";
import { GRANULARITY_LABEL } from "@/lib/utils";
import { Play, Zap, Plus, Share2, EyeOff, Eye } from "lucide-react";
import { useCanvasStore } from "@/lib/store";

/**
 * Canvas chrome (graph-canvas.md §5). Which action affordances mount is driven
 * by LayoutSpec.parallelism_ui / delegation_ui (hidden | branch_buttons |
 * dispatch_parallel | assign_clusters).
 */

export function CanvasToolbar({
  title,
  granularity,
  layoutSpec,
  nodeCount,
  onRunAll,
  onDispatchParallel,
  onAddContext,
  onShare,
  running,
}: {
  title: string;
  granularity: Granularity;
  layoutSpec: LayoutSpec | null;
  nodeCount: number;
  onRunAll: () => void;
  onDispatchParallel: () => void;
  onAddContext: () => void;
  onShare: () => void;
  running: boolean;
}) {
  const hideSoftEdges = useCanvasStore((s) => s.hideSoftEdges);
  const toggleSoftEdges = useCanvasStore((s) => s.toggleSoftEdges);
  const parallelism = layoutSpec?.parallelism_ui ?? "branch_buttons";
  const delegation = layoutSpec?.delegation_ui ?? "per_branch";
  const g = GRANULARITY_LABEL[granularity];

  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface/80 px-4 py-2.5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-fg-muted" title={`${g.full} (${nodeCount} nodes)`}>
          {g.short}
        </span>
        <h1 className="truncate text-sm font-semibold text-fg">{title}</h1>
        {layoutSpec && (
          <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted sm:inline">
            {layoutSpec.canvas}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="sm" icon={hideSoftEdges ? <Eye size={13} /> : <EyeOff size={13} />} onClick={toggleSoftEdges}>
          {hideSoftEdges ? "Show soft edges" : "Hide soft edges"}
        </Button>

        {delegation !== "share_diff" && (
          <Button variant="ghost" size="sm" icon={<Share2 size={13} />} onClick={onShare}>
            Share
          </Button>
        )}

        <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={onAddContext}>
          Add context
        </Button>

        {parallelism === "dispatch_parallel" || parallelism === "assign_clusters" ? (
          <Button variant="primary" size="sm" icon={<Zap size={13} />} onClick={onDispatchParallel} loading={running}>
            Dispatch parallel
          </Button>
        ) : parallelism === "branch_buttons" ? (
          <Button variant="primary" size="sm" icon={<Play size={13} />} onClick={onRunAll} loading={running}>
            Run all
          </Button>
        ) : null}
      </div>
    </div>
  );
}

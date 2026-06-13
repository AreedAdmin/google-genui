"use client";

import * as React from "react";
import type { PlanGraph } from "@trellis/shared";
import { analyzeIndependence } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";
import { Zap, AlertTriangle, X, Scissors } from "lucide-react";
import { shortRef } from "@/lib/utils";

/**
 * Multi-select feedback (graph-canvas.md §4). Selecting mutually-independent
 * nodes lights a "⚡ N branches parallel-safe" banner; overlapping selections
 * show WHY they cannot be parallelized, citing the shared file.
 */

export function SelectionBanner({
  graph,
  selection,
  onDispatch,
  onPrune,
  onClear,
  running,
}: {
  graph: PlanGraph;
  selection: string[];
  onDispatch: (ids: string[]) => void;
  onPrune?: (ids: string[]) => void;
  onClear: () => void;
  running: boolean;
}) {
  if (selection.length < 2) return null;
  const result = analyzeIndependence(graph, selection);

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 w-[min(560px,calc(100%-2rem))] -translate-x-1/2 animate-fade-in rounded-xl border border-border bg-surface p-3 shadow-pop">
      <div className="flex items-center gap-2">
        {result.parallelSafe ? (
          <>
            <Zap size={15} className="text-[var(--st-built)]" aria-hidden />
            <span className="text-sm font-medium text-fg">
              {result.branchCount} branches parallel-safe
            </span>
            <span className="text-xs text-fg-muted">{selection.length} nodes selected</span>
          </>
        ) : (
          <>
            <AlertTriangle size={15} className="text-[var(--st-blocked)]" aria-hidden />
            <span className="text-sm font-medium text-[var(--st-blocked)]">Cannot parallelize — shared files</span>
          </>
        )}
        <button onClick={onClear} aria-label="Clear selection" className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-surface-2">
          <X size={14} />
        </button>
      </div>

      {!result.parallelSafe && result.conflicts.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-fg-muted">
          {result.conflicts.slice(0, 3).map((c, i) => (
            <li key={i} className="font-mono">
              ⚠ share {c.shared.map(shortRef).join(", ")}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2.5 flex justify-end gap-2">
        {onPrune && (
          <Button variant="secondary" size="sm" icon={<Scissors size={13} />} onClick={() => onPrune(selection)}>
            Prune &amp; share
          </Button>
        )}
        <Button
          variant={result.parallelSafe ? "primary" : "secondary"}
          size="sm"
          icon={<Zap size={13} />}
          disabled={!result.parallelSafe}
          loading={running}
          onClick={() => onDispatch(selection)}
        >
          Dispatch {selection.length} node{selection.length > 1 ? "s" : ""}
        </Button>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import type { NodeStatus } from "@trellis/shared";
import { useNodeDiff } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { FileDiff, AlertTriangle } from "lucide-react";

/**
 * The real per-node build diff (Changes tab). Fetches the latest node_build run's
 * captured `git diff` and renders it +/- line-colored. Polls while the node is
 * running so it fills in when the Claude Code runner finishes.
 */
export function NodeDiff({ nodeId, status }: { nodeId: string; status: NodeStatus }) {
  const { data, isLoading } = useNodeDiff(nodeId, status);

  if (!data || !data.run_id) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-4 text-center text-xs text-fg-muted">
        {status === "running"
          ? "Building… the diff appears here when the run completes."
          : "Run this node to generate and review its code diff."}
      </div>
    );
  }

  const hasDiff = data.diff.trim().length > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1 font-medium text-fg">
          <FileDiff size={12} aria-hidden /> Build diff
        </span>
        <span>
          · {data.files_touched.length} file{data.files_touched.length === 1 ? "" : "s"}
        </span>
        {data.drift.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[var(--st-blocked)]" title={data.drift.join(", ")}>
            <AlertTriangle size={11} aria-hidden /> {data.drift.length} drift
          </span>
        )}
        <span className="ml-auto">{data.status}</span>
      </div>

      {isLoading && !hasDiff ? (
        <p className="text-xs text-fg-muted">Loading diff…</p>
      ) : hasDiff ? (
        <DiffView diff={data.diff} />
      ) : (
        <p className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-xs text-fg-muted">
          Run completed with no file changes.
        </p>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="scroll-thin max-h-[420px] overflow-auto rounded-lg border border-border bg-surface-2/40 p-2 text-[11px] leading-relaxed">
      <code className="font-mono">
        {lines.map((line, i) => {
          const kind =
            line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")
              ? "meta"
              : line.startsWith("@@")
                ? "hunk"
                : line.startsWith("+")
                  ? "add"
                  : line.startsWith("-")
                    ? "del"
                    : "ctx";
          return (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-all px-1",
                kind === "add" && "bg-[color-mix(in_srgb,var(--st-built)_14%,transparent)] text-[var(--st-built)]",
                kind === "del" && "bg-[color-mix(in_srgb,var(--st-failed)_12%,transparent)] text-[var(--st-failed)]",
                kind === "hunk" && "text-accent",
                kind === "meta" && "text-fg-muted",
                kind === "ctx" && "text-fg",
              )}
            >
              {line || " "}
            </div>
          );
        })}
      </code>
    </pre>
  );
}

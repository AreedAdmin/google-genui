"use client";

import * as React from "react";
import { useCanvasStore } from "@/lib/store";
import { Terminal } from "lucide-react";

/**
 * Live run log / streamed diff viewer (node-inspector.md §7). While a node is
 * running, chunks stream from the run SSE into the Zustand overlay; this shows
 * the rolling tail with a live progress header.
 */
export function RunLog({ nodeId }: { nodeId: string }) {
  const progress = useCanvasStore((s) => s.runProgress[nodeId]);
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progress?.log.length]);

  if (!progress) return null;

  const pct = Math.round((progress.progress ?? 0) * 100);
  const running = progress.status === "running" || progress.status === "queued";
  const label = progress.status === "succeeded" ? "Run complete" : progress.status === "failed" ? "Run failed" : "Live run";
  const color =
    progress.status === "succeeded" ? "var(--st-built)" : progress.status === "failed" ? "var(--st-blocked)" : "var(--st-running)";

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Terminal size={13} style={{ color }} /> {label}
          {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: color }} />}
        </span>
        <span className="text-[11px] tabular-nums text-fg-muted">
          {pct}% · {progress.tokens.toLocaleString()} tok
        </span>
      </div>
      <div className="h-1 bg-surface-2">
        <div className="h-full rounded-r-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="scroll-thin max-h-44 overflow-y-auto p-2.5 font-mono text-[10.5px] leading-relaxed text-fg-muted">
        {progress.log.length === 0 ? (
          <p className="italic">waiting for output…</p>
        ) : (
          progress.log.map((line, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {line}
            </p>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

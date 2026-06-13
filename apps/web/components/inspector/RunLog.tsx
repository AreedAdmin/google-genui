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

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold">
          <Terminal size={13} className="text-fg-muted" /> Live run
        </span>
        <span className="text-[11px] tabular-nums text-fg-muted">
          {Math.round((progress.progress ?? 0) * 100)}% · {progress.tokens} tok
        </span>
      </div>
      <div className="h-1 bg-surface-2">
        <div className="h-full rounded-r-full transition-all" style={{ width: `${Math.round((progress.progress ?? 0) * 100)}%`, background: "var(--st-running)" }} />
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

"use client";

import * as React from "react";

/**
 * Shown on the canvas while the plan-build worker is still running (plan.status
 * = planning/draft, no nodes persisted yet). An animated mini-DAG — nodes pulse
 * in sequence and edges "flow" — plus a cycling status line, so the user knows
 * the generative UI is being produced (not that there's nothing to do).
 */

const STAGES = [
  "Cloning & indexing your repo…",
  "Decomposing the request…",
  "Grounding in your repo's real symbols…",
  "Deriving the dependency graph…",
];

const NODES = [
  { cx: 34, cy: 60 },
  { cx: 112, cy: 28 },
  { cx: 112, cy: 92 },
  { cx: 206, cy: 60 },
];
const EDGES: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
];

export function PlanGenerating({ title }: { title?: string }) {
  const [stage, setStage] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center">
      <style>{`
        @keyframes trellis-dash { to { stroke-dashoffset: -20; } }
        @keyframes trellis-node { 0%,100% { opacity: .3; } 50% { opacity: 1; } }
      `}</style>

      <svg width="240" height="120" viewBox="0 0 240 120" fill="none" role="img" aria-label="Generating plan graph">
        {EDGES.map(([a, b], i) => (
          <line
            key={`e${i}`}
            x1={NODES[a]!.cx}
            y1={NODES[a]!.cy}
            x2={NODES[b]!.cx}
            y2={NODES[b]!.cy}
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeDasharray="4 6"
            strokeLinecap="round"
            style={{ animation: "trellis-dash 0.9s linear infinite", opacity: 0.55 }}
          />
        ))}
        {NODES.map((n, i) => (
          <circle
            key={`n${i}`}
            cx={n.cx}
            cy={n.cy}
            r="8"
            fill="var(--surface)"
            stroke="var(--accent)"
            strokeWidth="2"
            style={{ animation: "trellis-node 1.5s ease-in-out infinite", animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </svg>

      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">Generating your plan…</p>
        {title && <p className="max-w-sm truncate text-xs text-fg-muted">{title}</p>}
        <p className="text-xs text-accent" aria-live="polite">
          {STAGES[stage]}
        </p>
      </div>

      <p className="max-w-xs text-[11px] text-fg-muted">
        Trellis is reading your repo and building a grounded dependency graph. This usually takes 10–40s.
      </p>
    </div>
  );
}

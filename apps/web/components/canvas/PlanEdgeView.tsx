"use client";

import * as React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { EdgeType, EdgeEvidence } from "@trellis/shared";
import { edgeVisual } from "@/lib/design";
import { AlertTriangle } from "lucide-react";

/**
 * Typed edge renderer (graph-canvas.md §3, component-library.md §3). Stroke
 * style encodes edge_type; overlap_score > 0 adds a ⚠ glyph + warning tint.
 * Hover reveals an evidence popover built from plan_edges.evidence + rationale —
 * never invented (ground-or-fallback).
 */

export interface PlanEdgeData extends Record<string, unknown> {
  edgeType: EdgeType;
  rationale: string;
  evidence: EdgeEvidence;
  overlapScore: number;
}

export function PlanEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps) {
  const d = (data ?? {}) as PlanEdgeData;
  const v = edgeVisual(d.edgeType ?? "depends_on");
  const overlap = d.overlapScore ?? 0;
  const [hover, setHover] = React.useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const stroke = overlap > 0 ? "var(--st-blocked)" : `var(${v.strokeVar})`;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={v.arrow ? markerEnd : undefined}
        style={{
          stroke: selected ? "var(--accent)" : stroke,
          strokeWidth: hover ? v.width + 0.75 : v.width,
          strokeDasharray: v.dashed ? "5 4" : undefined,
          opacity: v.dashed ? 0.7 : 1,
        }}
      />
      {/* invisible wide hit area for hover */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={16} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ cursor: "pointer" }} />

      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: labelX, top: labelY }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          {overlap > 0 && !hover && (
            <span
              className="flex h-4 w-4 items-center justify-center rounded-full"
              style={{ background: "var(--surface)", border: "1px solid var(--st-blocked)" }}
              aria-label={`overlap ${overlap.toFixed(2)}`}
            >
              <AlertTriangle size={9} className="text-[var(--st-blocked)]" />
            </span>
          )}
          {hover && (
            <div className="w-60 rounded-lg border border-border bg-surface p-2.5 text-left shadow-pop" role="tooltip">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">why this edge · {v.label}</p>
              {d.evidence ? (
                <dl className="space-y-1 text-[11px]">
                  <Row k="reason" val={d.evidence.reason} />
                  {d.evidence.shared.length > 0 && <Row k="shared" val={d.evidence.shared.join(", ")} mono />}
                  {(d.evidence.from_provides.length > 0 || d.evidence.to_consumes.length > 0) && (
                    <Row k="flow" val={`${d.evidence.from_provides.join(",") || "—"} → ${d.evidence.to_consumes.join(",") || "—"}`} mono />
                  )}
                  <Row
                    k="overlap"
                    val={`${overlap.toFixed(2)} ${overlap === 0 ? "(safe to parallelize)" : "(serialize)"}`}
                  />
                </dl>
              ) : (
                <p className="text-[11px] italic text-[var(--st-blocked)]">unverified — no engine evidence</p>
              )}
              {d.rationale && <p className="mt-1.5 border-t border-border pt-1.5 text-[11px] text-fg-muted">{d.rationale}</p>}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function Row({ k, val, mono }: { k: string; val: string; mono?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="w-14 shrink-0 text-fg-muted">{k}</dt>
      <dd className={mono ? "font-mono text-[10.5px] text-fg" : "text-fg"}>{val}</dd>
    </div>
  );
}

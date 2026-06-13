"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ChangeType, NodeStatus, Granularity } from "@trellis/shared";
import { changeTypeVisual, statusVisual, branchTint } from "@/lib/design";
import { ConfidenceMeter } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { Play, AlertTriangle, MoreHorizontal } from "lucide-react";

/**
 * Custom node face (graph-canvas.md §2, component-library.md §2). Appearance is
 * a pure function of change_type (icon + accent bar), node_status (border + pill
 * treatment), confidence, emphasis badges, and branch tint. Color is never the
 * only signal — icon + label always present.
 */

export interface PlanNodeData extends Record<string, unknown> {
  title: string;
  changeType: ChangeType;
  nodeStatus: NodeStatus;
  confidence: number;
  emphasis: string[];
  branchLabel: string | null;
  branchIndex: number | null;
  branchIndependent: boolean;
  falseIndependenceRefs: string[];
  progress?: number;
  isSuperNode?: boolean;
  granularity: Granularity;
  onRun?: (id: string) => void;
  onOpen?: (id: string) => void;
}

function statusBorder(status: NodeStatus): React.CSSProperties {
  const v = statusVisual(status);
  const base: React.CSSProperties = { borderColor: "var(--border)" };
  switch (status) {
    case "pending":
      return { borderStyle: "dashed", borderColor: "var(--border-strong)" };
    case "skipped":
      return { borderStyle: "dotted", borderColor: "var(--border-strong)", opacity: 0.6 };
    case "running":
      return { borderColor: `var(--${v.token})`, boxShadow: `0 0 0 1px var(--${v.token})` };
    case "built":
    case "merged":
    case "failed":
    case "blocked":
      return { borderColor: `var(--${v.token})` };
    default:
      return base;
  }
}

export function PlanNodeView({ id, data, selected }: NodeProps) {
  const d = data as PlanNodeData;
  const ct = changeTypeVisual(d.changeType);
  const st = statusVisual(d.nodeStatus);
  const Icon = ct.icon;
  const StatusIcon = st.icon;
  const tint = d.branchIndex !== null ? branchTint(d.branchIndex) : null;
  const flagged = d.falseIndependenceRefs.length > 0;
  const runnable = d.nodeStatus === "ready" || d.nodeStatus === "failed";

  return (
    <div
      className={cn(
        "group relative flex w-[248px] flex-col gap-1 rounded-lg border bg-surface px-3 py-2.5 text-left shadow-card transition-shadow",
        d.nodeStatus === "running" && "animate-pulse-ring",
        selected && "ring-2",
      )}
      style={{
        ...statusBorder(d.nodeStatus),
        ...(selected ? ({ "--tw-ring-color": "var(--ring)" } as React.CSSProperties) : {}),
      }}
      role="listitem"
      aria-label={`${ct.label} node ${d.title}, status ${st.label}, confidence ${(d.confidence * 100).toFixed(0)} percent`}
    >
      {/* change_type accent bar */}
      <span className="absolute left-0 top-0 h-full w-[3px] rounded-l-lg" style={{ background: `var(--${ct.token})` }} aria-hidden />

      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />

      {/* header row: change_type · flags · confidence */}
      <div className="flex items-center gap-1.5 pl-1.5">
        <Icon size={13} style={{ color: `var(--${ct.token})` }} aria-hidden />
        <span className="text-[11px] font-medium" style={{ color: `var(--${ct.token})` }}>
          {ct.label}
        </span>
        {flagged && (
          <span title={`shares ${d.falseIndependenceRefs.join(", ")}`} aria-label="false-independence warning">
            <AlertTriangle size={12} className="text-[var(--st-blocked)]" />
          </span>
        )}
        <span className="ml-auto">
          <ConfidenceMeter value={d.confidence} />
        </span>
      </div>

      {/* title */}
      <p className="pl-1.5 text-sm font-semibold leading-snug text-fg line-clamp-3 break-words">{d.title}</p>

      {/* emphasis badges + quick actions */}
      <div className="flex items-center gap-1 pl-1.5">
        {d.emphasis.slice(0, 2).map((e) => (
          <span key={e} className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-fg-muted">
            {e}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {runnable && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                d.onRun?.(id);
              }}
              aria-label="Run node"
              className="inline-flex h-6 items-center gap-0.5 rounded bg-primary px-1.5 text-[10px] font-medium text-primary-fg hover:opacity-90"
            >
              <Play size={10} /> Run
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              d.onOpen?.(id);
            }}
            aria-label="Open inspector"
            className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-surface-2"
          >
            <MoreHorizontal size={13} />
          </button>
        </span>
      </div>

      {/* branch tint + status + live progress */}
      <div className="mt-0.5 flex items-center gap-1.5 border-t border-border pl-1.5 pt-1.5">
        {tint && (
          <span className="inline-flex items-center gap-1 text-[10px] text-fg-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: tint }} aria-hidden />
            {d.branchLabel}
            {d.branchIndependent && <span title="proven parallel-safe">∥</span>}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: `var(--${st.token})` }}>
          <StatusIcon size={11} className={d.nodeStatus === "running" ? "animate-spin" : ""} aria-hidden />
          {st.label}
        </span>
      </div>

      {d.nodeStatus === "running" && d.progress !== undefined && (
        <div className="mx-1.5 h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.round((d.progress ?? 0) * 100)}%`, background: `var(--${st.token})` }} />
        </div>
      )}
    </div>
  );
}

/** Super-node (collapsed cluster) face for G4. */
export function SuperNodeView({ id, data, selected }: NodeProps) {
  const d = data as PlanNodeData;
  const ct = changeTypeVisual(d.changeType);
  const st = statusVisual(d.nodeStatus);
  const Icon = ct.icon;
  const StatusIcon = st.icon;

  return (
    <button
      onClick={() => d.onOpen?.(id)}
      className={cn(
        "relative flex w-[220px] flex-col gap-1.5 rounded-xl border-2 bg-surface px-4 py-3.5 text-left shadow-card transition-all hover:shadow-pop",
        selected && "ring-2",
      )}
      style={{ borderColor: `color-mix(in srgb, var(--${ct.token}) 50%, var(--border))`, ...(selected ? ({ "--tw-ring-color": "var(--ring)" } as React.CSSProperties) : {}) }}
      aria-label={`Cluster ${d.title}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
      <div className="flex items-center gap-1.5">
        <Icon size={15} style={{ color: `var(--${ct.token})` }} aria-hidden />
        <span className="inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: `var(--${st.token})` }}>
          <StatusIcon size={11} className={d.nodeStatus === "running" ? "animate-spin" : ""} aria-hidden />
          {st.label}
        </span>
      </div>
      <p className="text-[15px] font-semibold leading-tight text-fg">{d.title}</p>
      <p className="text-[10px] text-fg-muted">click to expand ▾</p>
    </button>
  );
}

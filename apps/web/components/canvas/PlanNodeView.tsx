"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ChangeType, NodeStatus, Granularity } from "@trellis/shared";
import { changeTypeVisual, statusVisual, branchTint } from "@/lib/design";
import { ConfidenceMeter } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { Play, AlertTriangle, MoreHorizontal } from "lucide-react";

/**
 * Node face (graph-canvas.md §2). Dense, technical "intelligence-tool" card:
 * a status-colored left rail, a monospace change-type tag, the title, optional
 * emphasis chips, and a metadata footer (status · branch). Color is never the
 * only signal — icon + label always present. Handles are direction-aware so the
 * card works in both top-down (TB) and left-right (LR) layouts.
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
  /** Layout flow direction — drives handle placement. */
  dir?: "LR" | "TB";
  onRun?: (id: string) => void;
  onOpen?: (id: string) => void;
}

function borderTreatment(status: NodeStatus): React.CSSProperties {
  switch (status) {
    case "pending":
      return { borderStyle: "dashed", borderColor: "var(--border-strong)" };
    case "skipped":
      return { borderStyle: "dotted", borderColor: "var(--border-strong)", opacity: 0.65 };
    default:
      return { borderColor: "var(--border)" };
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
  const isTB = d.dir === "TB";
  const handleCls = "!h-2.5 !w-2.5 !border-2";
  const handleStyle = { background: "var(--border-strong)", borderColor: "var(--surface)" } as React.CSSProperties;

  return (
    <div
      className={cn(
        "group relative w-[272px] rounded-md border bg-surface shadow-card transition-all duration-150",
        "hover:shadow-pop hover:-translate-y-px",
        d.nodeStatus === "running" && "animate-pulse-ring",
        selected && "ring-2",
      )}
      style={{
        ...borderTreatment(d.nodeStatus),
        ...(selected ? ({ borderColor: "var(--accent)", "--tw-ring-color": "var(--ring)" } as React.CSSProperties) : {}),
      }}
      role="listitem"
      aria-label={`${ct.label} node ${d.title}, status ${st.label}, confidence ${(d.confidence * 100).toFixed(0)} percent`}
    >
      {/* status rail (left edge, full height) */}
      <span
        className="absolute inset-y-0 left-0 w-[3px] rounded-l-md"
        style={{ background: `var(--${st.token})` }}
        aria-hidden
      />

      <Handle type="target" position={isTB ? Position.Top : Position.Left} className={handleCls} style={handleStyle} />
      <Handle type="source" position={isTB ? Position.Bottom : Position.Right} className={handleCls} style={handleStyle} />

      <div className="py-2 pl-3 pr-2.5">
        {/* meta row: change-type tag · flags · confidence */}
        <div className="flex items-center gap-1.5">
          <Icon size={12} style={{ color: `var(--${ct.token})` }} aria-hidden />
          <span
            className="font-mono text-[9.5px] font-bold uppercase tracking-[0.09em]"
            style={{ color: `var(--${ct.token})` }}
          >
            {ct.label}
          </span>
          {flagged && (
            <span title={`shares ${d.falseIndependenceRefs.join(", ")}`} aria-label="false-independence warning">
              <AlertTriangle size={11} className="text-[var(--st-blocked)]" />
            </span>
          )}
          <span className="ml-auto">
            <ConfidenceMeter value={d.confidence} />
          </span>
        </div>

        {/* title */}
        <p className="mt-1.5 text-[13px] font-semibold leading-snug text-fg line-clamp-3 break-words">{d.title}</p>

        {/* emphasis chips */}
        {d.emphasis.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {d.emphasis.slice(0, 3).map((e) => (
              <span
                key={e}
                className="rounded-sm border border-border bg-surface-2 px-1 py-px font-mono text-[8.5px] font-medium uppercase tracking-wide text-fg-muted"
              >
                {e}
              </span>
            ))}
          </div>
        )}

        {/* footer: status · branch */}
        <div className="mt-2 flex items-center gap-2 border-t border-border pt-1.5">
          <span
            className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: `var(--${st.token})` }}
          >
            <StatusIcon size={11} className={d.nodeStatus === "running" ? "animate-spin" : ""} aria-hidden />
            {st.label}
          </span>
          {tint && (
            <span className="ml-auto inline-flex min-w-0 items-center gap-1 text-[10px] text-fg-muted">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tint }} aria-hidden />
              <span className="max-w-[96px] truncate font-mono">{d.branchLabel}</span>
              {d.branchIndependent && (
                <span title="proven parallel-safe" className="shrink-0 text-fg-muted">
                  ∥
                </span>
              )}
            </span>
          )}
        </div>

        {/* live progress */}
        {d.nodeStatus === "running" && d.progress !== undefined && (
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.round((d.progress ?? 0) * 100)}%`, background: `var(--${st.token})` }}
            />
          </div>
        )}
      </div>

      {/* hover actions (top-right overlay) */}
      <div className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
        {runnable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              d.onRun?.(id);
            }}
            aria-label="Run node"
            className="inline-flex h-5 items-center gap-0.5 rounded-sm bg-primary px-1.5 text-[9px] font-bold uppercase tracking-wide text-primary-fg shadow-sm hover:opacity-90"
          >
            <Play size={9} /> Run
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            d.onOpen?.(id);
          }}
          aria-label="Open inspector"
          className="inline-flex h-5 w-5 items-center justify-center rounded-sm border border-border bg-surface text-fg-muted shadow-sm hover:text-fg"
        >
          <MoreHorizontal size={12} />
        </button>
      </div>
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
  const isTB = d.dir === "TB";

  return (
    <button
      onClick={() => d.onOpen?.(id)}
      className={cn(
        "relative flex w-[240px] flex-col gap-1.5 rounded-md border-2 bg-surface px-4 py-3.5 text-left shadow-card transition-all hover:shadow-pop hover:-translate-y-px",
        selected && "ring-2",
      )}
      style={{
        borderColor: `color-mix(in srgb, var(--${ct.token}) 55%, var(--border))`,
        ...(selected ? ({ "--tw-ring-color": "var(--ring)" } as React.CSSProperties) : {}),
      }}
      aria-label={`Cluster ${d.title}`}
    >
      <span className="absolute inset-y-0 left-0 w-[3px] rounded-l-md" style={{ background: `var(--${st.token})` }} aria-hidden />
      <Handle type="target" position={isTB ? Position.Top : Position.Left} className="!h-2.5 !w-2.5 !border-2" />
      <Handle type="source" position={isTB ? Position.Bottom : Position.Right} className="!h-2.5 !w-2.5 !border-2" />
      <div className="flex items-center gap-1.5">
        <Icon size={15} style={{ color: `var(--${ct.token})` }} aria-hidden />
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.09em]" style={{ color: `var(--${ct.token})` }}>
          cluster
        </span>
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase" style={{ color: `var(--${st.token})` }}>
          <StatusIcon size={11} className={d.nodeStatus === "running" ? "animate-spin" : ""} aria-hidden />
          {st.label}
        </span>
      </div>
      <p className="text-[15px] font-semibold leading-tight text-fg">{d.title}</p>
      <p className="font-mono text-[10px] text-fg-muted">click to expand ▾</p>
    </button>
  );
}

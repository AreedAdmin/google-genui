"use client";

import * as React from "react";
import { z } from "zod";
import { Boxes, ArrowRight, CornerDownRight, CheckCircle2, Circle, Loader2, AlertTriangle } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";
import { DataTable } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * composed — the open-ended widget (generative-ui-deepening.md Change 3). Instead of
 * selecting one pre-built widget, the analysis agent COMPOSES a node body from a closed
 * vocabulary of primitive blocks: stat | table | tree | diff_row | timeline | text.
 *
 * Each block is validated INDEPENDENTLY here, so a single malformed/unknown block is
 * skipped (not fatal) while the rest render. The whole widget still never throws and
 * never renders raw HTML — same safety model as every other widget.
 */

// ---- the closed primitive vocabulary ----

const StatBlock = z.object({
  kind: z.literal("stat"),
  label: z.string(),
  value: z.string(),
  delta: z.string().optional(),
  tone: z.enum(["pos", "neg", "neutral"]).default("neutral"),
});
const TableBlock = z.object({
  kind: z.literal("table"),
  caption: z.string().optional(),
  columns: z.array(z.string()).default([]),
  rows: z.array(z.array(z.string())).default([]),
});
const TreeBlock = z.object({
  kind: z.literal("tree"),
  nodes: z
    .array(z.object({ label: z.string(), depth: z.number().int().min(0).max(8).default(0), detail: z.string().optional() }))
    .default([]),
});
const DiffRowBlock = z.object({
  kind: z.literal("diff_row"),
  label: z.string().optional(),
  before: z.string().nullable().default(null),
  after: z.string().nullable().default(null),
  status: z.enum(["added", "removed", "changed", "unchanged"]).default("changed"),
});
const TimelineBlock = z.object({
  kind: z.literal("timeline"),
  steps: z
    .array(z.object({ label: z.string(), state: z.enum(["done", "active", "todo", "blocked"]).default("todo"), detail: z.string().optional() }))
    .default([]),
});
const TextBlock = z.object({
  kind: z.literal("text"),
  body: z.string().default(""),
  emphasis: z.enum(["info", "warn", "muted"]).default("info"),
});

export const PrimitiveBlock = z.discriminatedUnion("kind", [StatBlock, TableBlock, TreeBlock, DiffRowBlock, TimelineBlock, TextBlock]);
export type PrimitiveBlock = z.infer<typeof PrimitiveBlock>;

/**
 * Registry-level props are deliberately LENIENT about block contents (blocks: unknown[])
 * so per-block validation can skip bad ones rather than failing the whole widget.
 */
export const ComposedProps = z.object({
  title: z.string().optional(),
  blocks: z.array(z.unknown()).default([]),
});
export type ComposedProps = z.infer<typeof ComposedProps>;

// ---- per-primitive renderers (text renders as text — no HTML) ----

const statTone: Record<string, string> = { pos: "var(--st-built)", neg: "var(--st-failed)", neutral: "var(--fg)" };

function Stat({ b }: { b: z.infer<typeof StatBlock> }) {
  return (
    <div className="rounded-md border border-border px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-fg-muted">{b.label}</p>
      <p className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums" style={{ color: statTone[b.tone] }}>{b.value}</span>
        {b.delta && <span className="text-[11px] text-fg-muted">{b.delta}</span>}
      </p>
    </div>
  );
}

function Table({ b }: { b: z.infer<typeof TableBlock> }) {
  return (
    <DataTable>
      {b.columns.length > 0 && (
        <thead>
          <tr className="bg-surface-2/60 text-[10px] uppercase tracking-wide text-fg-muted">
            {b.columns.map((c, i) => <th key={i} className="px-2 py-1.5 font-medium">{c}</th>)}
          </tr>
        </thead>
      )}
      <tbody className="font-mono">
        {b.rows.map((row, i) => (
          <tr key={i} className="border-t border-border">
            {row.map((cell, j) => <td key={j} className="px-2 py-1 text-fg">{cell}</td>)}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

function Tree({ b }: { b: z.infer<typeof TreeBlock> }) {
  return (
    <ul className="space-y-1">
      {b.nodes.map((n, i) => (
        <li key={i} className="flex items-center gap-1.5 text-xs" style={{ marginLeft: n.depth * 14 }}>
          {n.depth > 0 && <CornerDownRight size={12} className="shrink-0 text-fg-muted" aria-hidden />}
          <span className="font-mono font-medium text-fg">{n.label}</span>
          {n.detail && <span className="text-[10.5px] text-fg-muted">· {n.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

const diffTone: Record<string, string> = { added: "var(--st-built)", removed: "var(--st-failed)", changed: "var(--st-blocked)", unchanged: "var(--fg-muted)" };

function DiffRow({ b }: { b: z.infer<typeof DiffRowBlock> }) {
  const tone = diffTone[b.status] ?? "var(--fg-muted)";
  return (
    <div className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs" style={{ borderColor: `color-mix(in srgb, ${tone} 35%, var(--border))` }}>
      {b.label && <span className="font-medium text-fg">{b.label}</span>}
      <span className="font-mono text-fg-muted">{b.before ?? "—"}</span>
      <ArrowRight size={11} className="shrink-0 text-fg-muted" aria-hidden />
      <span className="font-mono text-fg">{b.after ?? "—"}</span>
      <span className="ml-auto rounded px-1 text-[9px] font-semibold uppercase" style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
        {b.status}
      </span>
    </div>
  );
}

const tlState = {
  done: { icon: CheckCircle2, tone: "var(--st-built)" },
  active: { icon: Loader2, tone: "var(--st-blocked)" },
  todo: { icon: Circle, tone: "var(--fg-muted)" },
  blocked: { icon: AlertTriangle, tone: "var(--st-failed)" },
} as const;

function Timeline({ b }: { b: z.infer<typeof TimelineBlock> }) {
  return (
    <ul className="space-y-1">
      {b.steps.map((s, i) => {
        const st = tlState[s.state];
        const Icon = st.icon;
        return (
          <li key={i} className="flex items-start gap-2 text-xs">
            <Icon size={14} className={cn("mt-0.5 shrink-0", s.state === "active" && "animate-spin")} style={{ color: st.tone }} aria-hidden />
            <span>
              <span className={s.state === "done" ? "text-fg-muted line-through" : "text-fg"}>{s.label}</span>
              {s.detail && <span className="block text-[10.5px] text-fg-muted">{s.detail}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const textTone: Record<string, string> = { info: "text-fg", warn: "text-[var(--st-blocked)]", muted: "text-fg-muted" };

function Text({ b }: { b: z.infer<typeof TextBlock> }) {
  return <p className={cn("whitespace-pre-wrap text-xs leading-relaxed", textTone[b.emphasis])}>{b.body}</p>;
}

/** Validate one block in isolation; skip (don't crash) if it doesn't match the vocabulary. */
function renderBlock(raw: unknown, i: number): React.ReactElement {
  const parsed = PrimitiveBlock.safeParse(raw);
  if (!parsed.success) {
    return <p key={i} className="text-[10px] italic text-fg-muted">· skipped an unrenderable block</p>;
  }
  const b = parsed.data;
  switch (b.kind) {
    case "stat": return <Stat key={i} b={b} />;
    case "table": return <Table key={i} b={b} />;
    case "tree": return <Tree key={i} b={b} />;
    case "diff_row": return <DiffRow key={i} b={b} />;
    case "timeline": return <Timeline key={i} b={b} />;
    case "text": return <Text key={i} b={b} />;
    default: return <React.Fragment key={i} />;
  }
}

export function Composed(props: { spec: ComposedProps; grounding: string[]; confidence?: number; onJump?: (r: string) => void }) {
  const { title, blocks } = props.spec;
  return (
    <WidgetFrame
      title={title ?? "composed"}
      icon={<Boxes size={13} style={{ color: "var(--accent)" }} />}
      grounding={props.grounding}
      confidence={props.confidence}
      onJump={props.onJump}
    >
      {blocks.length > 0 ? (
        <div className="space-y-2">{blocks.map((b, i) => renderBlock(b, i))}</div>
      ) : (
        <p className="text-[11px] text-fg-muted">No blocks.</p>
      )}
    </WidgetFrame>
  );
}

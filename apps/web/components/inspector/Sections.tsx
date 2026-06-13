"use client";

import * as React from "react";
import type { PlanNode, NodeAnnotation } from "@trellis/shared";
import { SeverityTag, ConfidenceMeter } from "@/components/ui/primitives";
import { CitationRow, ClaimFeedback, LowConfidenceLabel } from "@/components/ui/trust";
import { SEVERITY } from "@/lib/design";
import { shortRef } from "@/lib/utils";
import { Plus, Pencil, Trash2, FileSymlink } from "lucide-react";

/**
 * The five inspector sections (node-inspector.md §2), each grounded in
 * touch_set / node_annotations. Every claim cites a real symbol/file or is
 * labeled low-confidence. Claims carry 👍/👎 feedback.
 */

export function ChangesSection({ node, onJump }: { node: PlanNode; onJump?: (r: string) => void }) {
  const ts = node.touch_set;
  const resolved = ts.resolved;
  const groups: { label: string; icon: React.ReactNode; items: { name: string; file?: string }[] }[] = [
    { label: "Add", icon: <Plus size={12} className="text-[var(--st-built)]" />, items: ts.predicted.add.map((s) => ({ name: s.name, file: s.file })) },
    { label: "Modify", icon: <Pencil size={12} className="text-[var(--st-blocked)]" />, items: ts.predicted.modify.map((s) => ({ name: s.name, file: s.file })) },
    { label: "Delete", icon: <Trash2 size={12} className="text-[var(--st-failed)]" />, items: ts.predicted.delete.map((s) => ({ name: s.name, file: s.file })) },
  ];

  const hasPredicted = groups.some((g) => g.items.length > 0);

  return (
    <div className="space-y-3">
      {hasPredicted ? (
        groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <div key={g.label}>
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                {g.icon}
                {g.label} ({g.items.length})
              </p>
              <ul className="space-y-1">
                {g.items.map((it, i) => (
                  <li key={`${it.name}-${i}`} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                    <span className="font-mono font-medium text-fg">{it.name}</span>
                    {it.file && (
                      <button onClick={() => onJump?.(`${it.file}#${it.name}`)} className="ml-auto truncate font-mono text-[10.5px] text-fg-muted hover:text-accent">
                        {it.file}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
      ) : (
        <p className="text-xs text-fg-muted">No predicted symbol changes.</p>
      )}

      {resolved && resolved.files.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Resolved files ({resolved.files.length})</p>
          <div className="flex flex-wrap gap-1">
            {resolved.files.map((f) => (
              <button key={f} onClick={() => onJump?.(f)} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted hover:text-accent">
                {shortRef(f)}
              </button>
            ))}
          </div>
        </div>
      )}

      {resolved && resolved.signatures_changed.length > 0 && (
        <div className="rounded-md border border-[color-mix(in_srgb,var(--st-failed)_40%,var(--border))] bg-[color-mix(in_srgb,var(--st-failed)_7%,transparent)] p-2">
          <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--st-failed)]">
            <FileSymlink size={12} /> Signature changes ({resolved.signatures_changed.length})
          </p>
          <ul className="space-y-0.5 font-mono text-[10.5px] text-fg">
            {resolved.signatures_changed.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {ts.resolution_confidence !== undefined && (
        <div className="flex items-center gap-2 text-[11px] text-fg-muted">
          resolution <ConfidenceMeter value={ts.resolution_confidence} showNumber />
        </div>
      )}
    </div>
  );
}

function ClaimRow({
  text,
  refs,
  confidence,
  nodeId,
  path,
  onJump,
  leading,
}: {
  text: string;
  refs: string[];
  confidence?: number;
  nodeId: string;
  path: string;
  onJump?: (r: string) => void;
  leading?: React.ReactNode;
}) {
  const low = refs.length === 0 || (confidence !== undefined && confidence < 0.5);
  return (
    <li className={`rounded-md border px-2.5 py-2 ${low ? "border-dashed border-border bg-surface-2/30" : "border-border"}`}>
      <div className="flex items-start gap-2">
        {leading}
        <p className={`flex-1 text-xs leading-relaxed ${low ? "text-fg-muted" : "text-fg"}`}>{text}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {confidence !== undefined && <ConfidenceMeter value={confidence} />}
          <ClaimFeedback nodeId={nodeId} annotationPath={path} />
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2 pl-0">
        {refs.length === 0 ? <LowConfidenceLabel /> : <CitationRow refs={refs} onJump={onJump} />}
      </div>
    </li>
  );
}

export function AssumptionsSection({ annotation, nodeId, onJump }: { annotation?: NodeAnnotation; nodeId: string; onJump?: (r: string) => void }) {
  const items = annotation?.assumptions ?? [];
  if (items.length === 0) return <p className="text-xs text-fg-muted">None surfaced.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((a, i) => (
        <ClaimRow key={i} text={a.text} refs={a.grounded_refs} confidence={a.confidence} nodeId={nodeId} path={`assumptions[${i}]`} onJump={onJump} />
      ))}
    </ul>
  );
}

export function AnalysisSection({ annotation, nodeId, onJump }: { annotation?: NodeAnnotation; nodeId: string; onJump?: (r: string) => void }) {
  const items = annotation?.analysis ?? [];
  if (items.length === 0) return <p className="text-xs text-fg-muted">No risks surfaced.</p>;
  // severity-sorted, high → low
  const sorted = items
    .map((a, i) => ({ a, i }))
    .sort((x, y) => SEVERITY[y.a.severity].rank - SEVERITY[x.a.severity].rank);
  return (
    <ul className="space-y-1.5">
      {sorted.map(({ a, i }) => (
        <ClaimRow
          key={i}
          text={a.text}
          refs={a.grounded_refs}
          confidence={a.confidence}
          nodeId={nodeId}
          path={`analysis[${i}]`}
          onJump={onJump}
          leading={
            <span className="flex shrink-0 flex-col items-start gap-1">
              <SeverityTag severity={a.severity} />
              <span className="rounded bg-surface-2 px-1 text-[9px] uppercase text-fg-muted">{a.kind.replace("_", " ")}</span>
            </span>
          }
        />
      ))}
    </ul>
  );
}

export function BenefitsSection({ annotation, nodeId, onJump }: { annotation?: NodeAnnotation; nodeId: string; onJump?: (r: string) => void }) {
  const items = annotation?.benefits ?? [];
  if (items.length === 0) return <p className="text-xs text-fg-muted">None surfaced.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((b, i) => (
        <ClaimRow key={i} text={b.text} refs={b.grounded_refs} nodeId={nodeId} path={`benefits[${i}]`} onJump={onJump} />
      ))}
    </ul>
  );
}

export function NotableSymbolsSection({ annotation, onJump }: { annotation?: NodeAnnotation; onJump?: (r: string) => void }) {
  const items = annotation?.notable_symbols ?? [];
  if (items.length === 0) return <p className="text-xs text-fg-muted">None surfaced.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((s, i) => (
        <li key={i} className="rounded-md border border-border px-2.5 py-2">
          <div className="flex items-center gap-2">
            <button onClick={() => onJump?.(`${s.file}#${s.symbol}`)} className="font-mono text-xs font-medium text-fg hover:text-accent">
              {s.symbol}
            </button>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] uppercase text-fg-muted">{s.role}</span>
            <span className="ml-auto truncate font-mono text-[10px] text-fg-muted">{s.file}</span>
          </div>
          <p className="mt-1 text-[11px] text-fg-muted">{s.why_notable}</p>
        </li>
      ))}
    </ul>
  );
}

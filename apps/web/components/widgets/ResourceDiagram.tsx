"use client";

import { z } from "zod";
import { Server, ArrowRight } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";

/**
 * resource_diagram — for change_type: infra. A declarative box-and-arrow view of
 * the infra resources a node adds/changes and how they connect
 * (widget-generation.md §5). Static structural render only — no execution, no
 * external fetch; resources/links come from the grounded spec.
 */

const changeTone: Record<string, string> = {
  added: "var(--st-built)",
  modified: "var(--st-blocked)",
  removed: "var(--st-failed)",
  unchanged: "var(--fg-muted)",
};

export const ResourceDiagramProps = z.object({
  resources: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.string().default("resource"),
        change: z.enum(["added", "modified", "removed", "unchanged"]).default("added"),
      }),
    )
    .default([]),
  links: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
      }),
    )
    .default([]),
});
export type ResourceDiagramProps = z.infer<typeof ResourceDiagramProps>;

export function ResourceDiagram(props: { spec: ResourceDiagramProps; grounding: string[]; confidence?: number; onJump?: (r: string) => void }) {
  const { resources, links } = props.spec;
  const nameOf = new Map(resources.map((r) => [r.id, r.name]));

  return (
    <WidgetFrame
      title="resources"
      icon={<Server size={13} style={{ color: "var(--ct-infra)" }} />}
      grounding={props.grounding}
      confidence={props.confidence}
      onJump={props.onJump}
    >
      {resources.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5">
          {resources.map((r) => {
            const tone = changeTone[r.change] ?? "var(--fg-muted)";
            return (
              <div key={r.id} className="rounded-md border px-2 py-1.5" style={{ borderColor: `color-mix(in srgb, ${tone} 40%, var(--border))` }}>
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-medium text-fg" title={r.name}>
                    {r.name}
                  </span>
                  <span className="shrink-0 rounded px-1 text-[9px] font-semibold uppercase" style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
                    {r.change}
                  </span>
                </div>
                <p className="text-[10px] uppercase tracking-wide text-fg-muted">{r.kind}</p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] text-fg-muted">No resources declared.</p>
      )}

      {links.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-t border-border pt-2">
          {links.map((l, i) => (
            <li key={`${l.from}-${l.to}-${i}`} className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
              <span className="font-medium text-fg">{nameOf.get(l.from) ?? l.from}</span>
              <ArrowRight size={11} aria-hidden />
              <span className="font-medium text-fg">{nameOf.get(l.to) ?? l.to}</span>
              {l.label && <span className="text-fg-muted">· {l.label}</span>}
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  );
}

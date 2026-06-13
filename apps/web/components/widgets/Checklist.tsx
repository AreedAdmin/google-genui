"use client";

import { z } from "zod";
import { ListChecks, CheckCircle2, Circle, Loader2, AlertTriangle } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";

/**
 * checklist — for change_type: test (and any node's acceptance steps). An ordered
 * list of steps/criteria with per-item state (widget-generation.md §5). Grounded
 * in the node's acceptance commands / touched test files.
 */

const STATE = {
  done: { icon: CheckCircle2, tone: "var(--st-built)" },
  active: { icon: Loader2, tone: "var(--st-blocked)" },
  todo: { icon: Circle, tone: "var(--fg-muted)" },
  blocked: { icon: AlertTriangle, tone: "var(--st-failed)" },
} as const;

export const ChecklistProps = z.object({
  title: z.string().optional(),
  items: z
    .array(
      z.object({
        label: z.string(),
        state: z.enum(["done", "active", "todo", "blocked"]).default("todo"),
        detail: z.string().optional(),
      }),
    )
    .default([]),
});
export type ChecklistProps = z.infer<typeof ChecklistProps>;

export function Checklist(props: { spec: ChecklistProps; grounding: string[]; confidence?: number; onJump?: (r: string) => void }) {
  const { title, items } = props.spec;
  const done = items.filter((it) => it.state === "done").length;

  return (
    <WidgetFrame
      title={title ?? "checklist"}
      icon={<ListChecks size={13} style={{ color: "var(--ct-test)" }} />}
      grounding={props.grounding}
      confidence={props.confidence}
      onJump={props.onJump}
    >
      {items.length > 0 ? (
        <>
          <ul className="space-y-1">
            {items.map((it, i) => {
              const s = STATE[it.state];
              const Icon = s.icon;
              return (
                <li key={`${it.label}-${i}`} className="flex items-start gap-2 text-xs">
                  <Icon size={14} className={it.state === "active" ? "mt-0.5 shrink-0 animate-spin" : "mt-0.5 shrink-0"} style={{ color: s.tone }} aria-hidden />
                  <span>
                    <span className={it.state === "done" ? "text-fg-muted line-through" : "text-fg"}>{it.label}</span>
                    {it.detail && <span className="block text-[10.5px] text-fg-muted">{it.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 border-t border-border pt-1.5 text-[10.5px] text-fg-muted">
            {done}/{items.length} complete
          </p>
        </>
      ) : (
        <p className="text-[11px] text-fg-muted">No steps.</p>
      )}
    </WidgetFrame>
  );
}

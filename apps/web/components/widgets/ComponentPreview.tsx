"use client";

import * as React from "react";
import { z } from "zod";
import { Layout } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";
import { cn } from "@/lib/utils";

/**
 * component_preview — for change_type: ui_component. A skeleton structural
 * preview + prop table + named states (widget-generation.md §4.3). The preview
 * defaults to `skeleton` mode (no execution) — there is NO raw-HTML / eval path;
 * the sandboxed-iframe mode is gated behind §9 controls and not enabled here.
 */

export const ComponentPreviewProps = z.object({
  name: z.string(),
  framework: z.enum(["react"]).default("react"),
  props: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        required: z.boolean().default(false),
        default: z.string().nullable().default(null),
      }),
    )
    .default([]),
  states: z
    .array(z.object({ label: z.string(), propsJson: z.string() }))
    .default([]),
  preview: z.object({
    mode: z.enum(["sandbox", "skeleton", "static_image"]).default("skeleton"),
    snippet_ref: z.string().nullable().default(null),
  }),
});
export type ComponentPreviewProps = z.infer<typeof ComponentPreviewProps>;

export function ComponentPreview(props: { spec: ComponentPreviewProps; grounding: string[]; confidence?: number; onJump?: (r: string) => void }) {
  const { name, props: propRows, states } = props.spec;
  const [activeState, setActiveState] = React.useState(0);

  return (
    <WidgetFrame
      title={`component · ${name}`}
      icon={<Layout size={13} style={{ color: "var(--ct-ui)" }} />}
      grounding={props.grounding}
      confidence={props.confidence}
      onJump={props.onJump}
    >
      {/* Skeleton structural preview (no execution of model output). */}
      <div className="mb-2.5 rounded-md border border-dashed border-border bg-surface-2/50 p-4">
        <div className="mx-auto flex max-w-[220px] flex-col items-center gap-2">
          <div className="skeleton h-8 w-full rounded-md" />
          <div className="skeleton h-8 w-full rounded-md" />
          <p className="text-[10px] text-fg-muted">skeleton preview — real render appears after build</p>
        </div>
      </div>

      {states.length > 0 && (
        <div className="mb-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">States</p>
          <div className="flex flex-wrap gap-1">
            {states.map((s, i) => (
              <button
                key={s.label}
                onClick={() => setActiveState(i)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                  i === activeState ? "border-accent text-accent" : "border-border text-fg-muted hover:text-fg",
                )}
              >
                {i === activeState ? "● " : "○ "}
                {s.label}
              </button>
            ))}
          </div>
          {states[activeState] && (
            <pre className="mt-1.5 overflow-x-auto rounded-md border border-border bg-surface-2/60 px-2 py-1.5 font-mono text-[10.5px] text-fg-muted">
              {states[activeState]!.propsJson}
            </pre>
          )}
        </div>
      )}

      {propRows.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Props</p>
          <table className="w-full border-collapse overflow-hidden rounded-md border border-border text-xs">
            <tbody className="font-mono">
              {propRows.map((p) => (
                <tr key={p.name} className="border-t border-border">
                  <td className="px-2 py-1 font-medium text-fg">{p.name}</td>
                  <td className="px-2 py-1 text-fg-muted">{p.type}</td>
                  <td className="px-2 py-1 text-[10px] text-fg-muted">
                    {p.required ? "required" : p.default !== null ? `default ${p.default}` : "optional"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetFrame>
  );
}

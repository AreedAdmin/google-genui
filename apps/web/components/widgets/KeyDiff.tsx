"use client";

import { z } from "zod";
import { SlidersHorizontal } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";

/**
 * key_diff — phase-2 widget for change_type: config. A 2-column key/value diff +
 * "who reads this key" consumers (widget-generation.md §5). Included so the G2
 * config node renders richly rather than falling back.
 */

export const KeyDiffProps = z.object({
  keys: z.array(
    z.object({
      key: z.string(),
      before: z.string().nullable().default(null),
      after: z.string().nullable().default(null),
      scope: z.enum(["env", "di", "config"]).default("config"),
      consumers: z.array(z.string()).default([]),
    }),
  ),
});
export type KeyDiffProps = z.infer<typeof KeyDiffProps>;

export function KeyDiff(props: { spec: KeyDiffProps; grounding: string[]; confidence?: number; onJump?: (r: string) => void }) {
  return (
    <WidgetFrame
      title="config keys"
      icon={<SlidersHorizontal size={13} style={{ color: "var(--ct-config)" }} />}
      grounding={props.grounding}
      confidence={props.confidence}
      onJump={props.onJump}
    >
      <table className="w-full border-collapse overflow-hidden rounded-md border border-border text-xs">
        <tbody className="font-mono">
          {props.spec.keys.map((k) => (
            <tr key={k.key} className="border-t border-border" style={{ background: k.before === null ? "color-mix(in srgb, var(--st-built) 8%, transparent)" : undefined }}>
              <td className="px-2 py-1 font-medium text-fg">{k.key}</td>
              <td className="px-2 py-1 text-fg-muted">{k.before ?? "—"}</td>
              <td className="px-2 py-1 text-fg-muted">→</td>
              <td className="px-2 py-1 text-fg">{k.after ?? "—"}</td>
              <td className="px-2 py-1 text-[9px] uppercase text-fg-muted">{k.scope}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.spec.keys.some((k) => k.consumers.length > 0) && (
        <p className="mt-1.5 text-[10.5px] text-fg-muted">
          read by{" "}
          <span className="font-mono text-fg">
            {Array.from(new Set(props.spec.keys.flatMap((k) => k.consumers))).join(", ")}
          </span>
        </p>
      )}
    </WidgetFrame>
  );
}

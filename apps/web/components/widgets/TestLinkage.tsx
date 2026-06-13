"use client";

import { z } from "zod";
import { FlaskConical, AlertTriangle } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";
import { shortRef } from "@/lib/utils";

/**
 * test_linkage — for change_type: bugfix | test. Maps the changed symbols to the
 * tests that cover them, flags coverage gaps, and marks tests added by this node
 * (widget-generation.md §5). Grounded in the touch-set symbols + test files.
 */

const statusTone: Record<string, string> = {
  passing: "var(--st-built)",
  failing: "var(--st-failed)",
  missing: "var(--st-blocked)",
  new: "var(--ct-test)",
};

export const TestLinkageProps = z.object({
  links: z
    .array(
      z.object({
        test: z.string(),
        file: z.string().optional(),
        covers: z.array(z.string()).default([]),
        status: z.enum(["passing", "failing", "missing", "new"]).default("passing"),
      }),
    )
    .default([]),
  uncovered: z.array(z.string()).default([]),
});
export type TestLinkageProps = z.infer<typeof TestLinkageProps>;

export function TestLinkage(props: { spec: TestLinkageProps; grounding: string[]; confidence?: number; onJump?: (r: string) => void }) {
  const { links, uncovered } = props.spec;

  return (
    <WidgetFrame
      title="test linkage"
      icon={<FlaskConical size={13} style={{ color: "var(--ct-test)" }} />}
      grounding={props.grounding}
      confidence={props.confidence}
      onJump={props.onJump}
    >
      {links.length > 0 ? (
        <ul className="space-y-1">
          {links.map((link, i) => (
            <li key={`${link.test}-${i}`} className="rounded-md border border-border px-2 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono font-medium text-fg" title={link.file ?? link.test}>
                  {link.test}
                </span>
                <span
                  className="ml-auto shrink-0 rounded px-1 text-[9px] font-semibold uppercase"
                  style={{ color: statusTone[link.status], background: `color-mix(in srgb, ${statusTone[link.status]} 14%, transparent)` }}
                >
                  {link.status}
                </span>
              </div>
              {link.covers.length > 0 && (
                <p className="mt-0.5 flex flex-wrap gap-1 text-[10.5px] text-fg-muted">
                  covers
                  {link.covers.map((c, j) => (
                    <button key={`${c}-${j}`} onClick={() => props.onJump?.(c)} className="font-mono text-fg hover:text-accent" title={c}>
                      {shortRef(c)}
                    </button>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-fg-muted">No tests linked yet.</p>
      )}

      {uncovered.length > 0 && (
        <div className="mt-2.5 rounded-md border border-[color-mix(in_srgb,var(--st-blocked)_40%,var(--border))] bg-[color-mix(in_srgb,var(--st-blocked)_7%,transparent)] p-2">
          <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--st-blocked)]">
            <AlertTriangle size={12} aria-hidden /> Uncovered ({uncovered.length})
          </p>
          <p className="flex flex-wrap gap-1 text-[10.5px]">
            {uncovered.map((s, i) => (
              <button key={`${s}-${i}`} onClick={() => props.onJump?.(s)} className="font-mono text-fg hover:text-accent" title={s}>
                {shortRef(s)}
              </button>
            ))}
          </p>
        </div>
      )}
    </WidgetFrame>
  );
}

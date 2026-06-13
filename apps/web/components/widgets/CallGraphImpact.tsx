"use client";

import { z } from "zod";
import { FunctionSquare, AlertTriangle, CornerDownRight } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";
import { shortRef, cn } from "@/lib/utils";

/**
 * call_graph_impact — for change_type: logic | refactor. The changed symbol,
 * its callers/callees, and the blast radius from the engine
 * (widget-generation.md §4.4). Props are grounded in the analysis service's
 * call-graph output, never invented.
 */

const ImpactNode = z.object({
  symbol: z.string(),
  file: z.string(),
  relation: z.enum(["root", "caller", "callee", "transitive"]),
  depth: z.number().int().min(0),
  risk: z.enum(["none", "signature", "behavior"]).default("none"),
});

export const CallGraphImpactProps = z.object({
  root: z.string(),
  affected: z.array(ImpactNode),
  blast_radius: z.object({
    files: z.number().int(),
    symbols: z.number().int(),
    crosses_branches: z.boolean().default(false),
  }),
  truncated: z.boolean().default(false),
});
export type CallGraphImpactProps = z.infer<typeof CallGraphImpactProps>;

const riskTone = (risk: string) => (risk === "signature" ? "var(--st-failed)" : risk === "behavior" ? "var(--st-blocked)" : "var(--fg-muted)");
const relationLabel: Record<string, string> = { root: "root", caller: "caller", callee: "callee", transitive: "transitive" };

export function CallGraphImpact(props: { spec: CallGraphImpactProps; grounding: string[]; confidence?: number; onJump?: (r: string) => void }) {
  const { root, affected, blast_radius, truncated } = props.spec;
  const maxDepth = Math.max(0, ...affected.map((a) => a.depth));

  return (
    <WidgetFrame
      title={`call graph · ${shortRef(root)}`}
      icon={<FunctionSquare size={13} style={{ color: "var(--ct-logic)" }} />}
      grounding={props.grounding}
      confidence={props.confidence}
      onJump={props.onJump}
    >
      <ul className="space-y-1">
        {affected.map((node, i) => (
          <li
            key={`${node.symbol}-${i}`}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs"
            style={{ marginLeft: node.depth * 14 }}
          >
            {node.depth > 0 && <CornerDownRight size={12} className="shrink-0 text-fg-muted" aria-hidden />}
            <button
              onClick={() => props.onJump?.(node.symbol)}
              className="truncate font-mono font-medium text-fg hover:text-accent"
              title={node.symbol}
            >
              {shortRef(node.symbol)}
            </button>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <span className="text-[10px] text-fg-muted">{relationLabel[node.relation]} · d{node.depth}</span>
              {node.risk !== "none" && (
                <span
                  className={cn("rounded px-1 text-[9px] font-semibold uppercase")}
                  style={{ color: riskTone(node.risk), background: `color-mix(in srgb, ${riskTone(node.risk)} 14%, transparent)` }}
                >
                  {node.risk === "signature" ? "sig△" : "behavior"}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {truncated && <p className="mt-1.5 text-[10px] text-fg-muted">graph capped for render — +more in the full inspector</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-[11px] text-fg-muted">
        <span>
          Blast radius: <span className="font-medium text-fg">{blast_radius.files} files</span> · <span className="font-medium text-fg">{blast_radius.symbols} symbols</span> · depth {maxDepth}
        </span>
        {blast_radius.crosses_branches && (
          <span className="inline-flex items-center gap-1 font-medium text-[var(--st-failed)]">
            <AlertTriangle size={11} aria-hidden /> crosses branches (shared symbol)
          </span>
        )}
      </div>
    </WidgetFrame>
  );
}

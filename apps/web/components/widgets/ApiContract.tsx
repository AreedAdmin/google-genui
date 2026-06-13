"use client";

import { z } from "zod";
import { Plug, AlertTriangle } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";
import { SeverityTag } from "@/components/ui/primitives";

/**
 * api_contract — for change_type: api_contract. Endpoint + request/response
 * shapes + status codes + breaking-change flags (widget-generation.md §4.2).
 */

const FieldShape = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean().default(false),
  note: z.string().optional(),
  change: z.enum(["added", "removed", "changed", "unchanged"]).default("unchanged"),
});

export const ApiContractProps = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  request: z.object({
    params: z.array(FieldShape).default([]),
    query: z.array(FieldShape).default([]),
    body: z.array(FieldShape).default([]),
  }),
  responses: z.array(
    z.object({
      status: z.number().int(),
      body: z.array(FieldShape).default([]),
      description: z.string().optional(),
    }),
  ),
  breaking: z
    .array(
      z.object({
        what: z.string(),
        why: z.string(),
        severity: z.enum(["low", "medium", "high"]),
      }),
    )
    .default([]),
});
export type ApiContractProps = z.infer<typeof ApiContractProps>;

const methodTone: Record<string, string> = {
  GET: "var(--st-built)",
  POST: "var(--ct-api)",
  PUT: "var(--st-blocked)",
  PATCH: "var(--st-blocked)",
  DELETE: "var(--st-failed)",
};

function changeBadge(change: string) {
  if (change === "unchanged") return null;
  const tone = change === "added" ? "var(--st-built)" : change === "removed" ? "var(--st-failed)" : "var(--st-blocked)";
  return (
    <span className="ml-1 rounded px-1 text-[9px] font-semibold uppercase" style={{ color: tone, background: `color-mix(in srgb, ${tone} 14%, transparent)` }}>
      {change}
    </span>
  );
}

function FieldRow({ kind, field }: { kind: string; field: z.infer<typeof FieldShape> }) {
  return (
    <tr className="border-t border-border">
      <td className="px-2 py-1 text-[10px] uppercase text-fg-muted">{kind}</td>
      <td className="px-2 py-1 font-mono font-medium text-fg">{field.name}</td>
      <td className="px-2 py-1 font-mono text-fg-muted">{field.type}</td>
      <td className="px-2 py-1 text-[10px] text-fg-muted">
        {field.required ? "required" : "optional"}
        {field.note ? ` · ${field.note}` : ""}
        {changeBadge(field.change)}
      </td>
    </tr>
  );
}

const statusTone = (s: number) => (s < 300 ? "var(--st-built)" : s < 400 ? "var(--st-blocked)" : "var(--st-failed)");

export function ApiContract(props: { spec: ApiContractProps; grounding: string[]; confidence?: number; onJump?: (r: string) => void }) {
  const { method, path, request, responses, breaking } = props.spec;
  const reqRows = [
    ...request.params.map((f) => ({ kind: "param", field: f })),
    ...request.query.map((f) => ({ kind: "query", field: f })),
    ...request.body.map((f) => ({ kind: "body", field: f })),
  ];

  return (
    <WidgetFrame
      title="API contract"
      icon={<Plug size={13} style={{ color: "var(--ct-api)" }} />}
      grounding={props.grounding}
      confidence={props.confidence}
      onJump={props.onJump}
    >
      <div className="mb-2.5 flex items-center gap-2 font-mono text-xs">
        <span className="rounded px-1.5 py-0.5 font-bold" style={{ color: methodTone[method] ?? "var(--ct-api)", background: `color-mix(in srgb, ${methodTone[method] ?? "var(--ct-api)"} 14%, transparent)` }}>
          {method}
        </span>
        <span className="text-fg">{path}</span>
      </div>

      {reqRows.length > 0 && (
        <div className="mb-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Request</p>
          <table className="w-full border-collapse overflow-hidden rounded-md border border-border text-xs">
            <tbody>{reqRows.map((r, i) => <FieldRow key={`${r.field.name}-${i}`} kind={r.kind} field={r.field} />)}</tbody>
          </table>
        </div>
      )}

      <div className="mb-1">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Responses</p>
        <div className="space-y-1">
          {responses.map((r, i) => (
            <div key={i} className="rounded-md border border-border px-2 py-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono font-bold" style={{ color: statusTone(r.status) }}>
                  {r.status}
                </span>
                {r.description && <span className="text-fg-muted">{r.description}</span>}
              </div>
              {r.body.length > 0 && (
                <p className="mt-0.5 font-mono text-[10.5px] text-fg-muted">
                  {`{ ${r.body.map((b) => `${b.name}: ${b.type}`).join(", ")} }`}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {breaking.length > 0 && (
        <div className="mt-2.5 rounded-md border border-[color-mix(in_srgb,var(--st-failed)_40%,var(--border))] bg-[color-mix(in_srgb,var(--st-failed)_7%,transparent)] p-2">
          <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[var(--st-failed)]">
            <AlertTriangle size={12} aria-hidden /> Breaking ({breaking.length})
          </p>
          <ul className="space-y-1">
            {breaking.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px]">
                <SeverityTag severity={b.severity} />
                <span>
                  <span className="font-medium text-fg">{b.what}</span>
                  <span className="block text-fg-muted">{b.why}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetFrame>
  );
}

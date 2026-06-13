"use client";

import { z } from "zod";
import { Database, Info } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";
import { DataTable } from "@/components/ui/primitives";

/**
 * schema_diff — for change_type: migration. Before/after table structure with a
 * per-column Δ, plus migration ordering vs siblings (widget-generation.md §4.1).
 */

const Column = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean().default(true),
  default: z.string().nullable().default(null),
  pk: z.boolean().default(false),
  fk: z.string().nullable().default(null),
});
const TableShape = z.object({
  table: z.string(),
  columns: z.array(Column),
  indexes: z
    .array(z.object({ name: z.string(), cols: z.array(z.string()), unique: z.boolean() }))
    .default([]),
});

export const SchemaDiffProps = z.object({
  kind: z.literal("table").default("table"),
  before: TableShape.nullable(),
  after: TableShape.nullable(),
  ordering: z
    .object({
      must_run_after: z.array(z.string()).default([]),
      reversible: z.boolean().default(true),
    })
    .optional(),
});
export type SchemaDiffProps = z.infer<typeof SchemaDiffProps>;

function describe(col: z.infer<typeof Column>): string {
  const bits = [col.type];
  if (col.pk) bits.push("pk");
  if (col.fk) bits.push(`fk→${col.fk}`);
  if (!col.nullable) bits.push("not null");
  if (col.default) bits.push(`default ${col.default}`);
  return bits.join(" ");
}

export function SchemaDiff(props: { spec: SchemaDiffProps; grounding: string[]; confidence?: number; onJump?: (r: string) => void }) {
  const { before, after, ordering } = props.spec;
  const beforeCols = new Map((before?.columns ?? []).map((c) => [c.name, c]));
  const afterCols = new Map((after?.columns ?? []).map((c) => [c.name, c]));
  const names = Array.from(new Set([...beforeCols.keys(), ...afterCols.keys()]));
  const tableName = after?.table ?? before?.table ?? "table";

  return (
    <WidgetFrame
      title={`schema · ${tableName}`}
      icon={<Database size={13} style={{ color: "var(--ct-migration)" }} />}
      grounding={props.grounding}
      confidence={props.confidence}
      onJump={props.onJump}
    >
      <DataTable>
        <thead>
          <tr className="bg-surface-2/60 text-[10px] uppercase tracking-wide text-fg-muted">
            <th className="px-2 py-1.5 font-medium">Column</th>
            <th className="px-2 py-1.5 font-medium">Before</th>
            <th className="px-2 py-1.5 font-medium">After</th>
            <th className="px-2 py-1.5 text-right font-medium">Δ</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {names.map((name) => {
            const b = beforeCols.get(name);
            const a = afterCols.get(name);
            const delta = !b ? "added" : !a ? "removed" : describe(b) !== describe(a) ? "changed" : "same";
            return (
              <tr
                key={name}
                className="border-t border-border"
                style={
                  delta === "added"
                    ? { background: "color-mix(in srgb, var(--st-built) 8%, transparent)" }
                    : delta === "removed"
                      ? { background: "color-mix(in srgb, var(--st-failed) 8%, transparent)" }
                      : delta === "changed"
                        ? { background: "color-mix(in srgb, var(--st-blocked) 8%, transparent)" }
                        : undefined
                }
              >
                <td className="px-2 py-1 font-medium text-fg">{name}</td>
                <td className="px-2 py-1 text-fg-muted">{b ? describe(b) : "—"}</td>
                <td className="px-2 py-1 text-fg">{a ? describe(a) : "—"}</td>
                <td className="px-2 py-1 text-right">
                  <span
                    className="text-[10px] font-semibold"
                    style={{
                      color:
                        delta === "added"
                          ? "var(--st-built)"
                          : delta === "removed"
                            ? "var(--st-failed)"
                            : delta === "changed"
                              ? "var(--st-blocked)"
                              : "var(--fg-muted)",
                    }}
                  >
                    {delta === "added" ? "+ added" : delta === "removed" ? "− removed" : delta === "changed" ? "~ changed" : "—"}
                  </span>
                </td>
              </tr>
            );
          })}
          {(after?.indexes ?? []).map((idx) => (
            <tr key={idx.name} className="border-t border-border" style={{ background: "color-mix(in srgb, var(--st-built) 8%, transparent)" }}>
              <td className="px-2 py-1 text-fg-muted" colSpan={3}>
                index {idx.name} ({idx.cols.join(", ")}){idx.unique ? " unique" : ""}
              </td>
              <td className="px-2 py-1 text-right text-[10px] font-semibold" style={{ color: "var(--st-built)" }}>
                + added
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {ordering && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
          <Info size={12} aria-hidden />
          {ordering.must_run_after.length > 0 ? (
            <>
              must run after <span className="font-medium text-fg">{ordering.must_run_after.join(", ")}</span>
            </>
          ) : (
            "no ordering constraints"
          )}
          <span>·</span>
          <span>{ordering.reversible ? "reversible ✓" : "irreversible ⚠"}</span>
        </p>
      )}
    </WidgetFrame>
  );
}

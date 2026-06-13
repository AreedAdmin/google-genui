"use client";

import * as React from "react";
import Link from "next/link";
import { usePlanList } from "@/lib/hooks";
import { Skeleton, EmptyState, StatusPill } from "@/components/ui/primitives";
import { GRANULARITY_LABEL, timeAgo } from "@/lib/utils";
import { FileStack, ArrowUpRight } from "lucide-react";

/**
 * Recent plans list on the home page. Each row deep-links to /p/[id]; the
 * granularity badge previews which generative layout the plan will render in.
 */
export function PlanList() {
  const { data, isLoading } = usePlanList();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return <EmptyState icon={<FileStack size={22} />} title="No plans yet" hint="Describe what to build above to generate your first plan." />;
  }

  return (
    <ul className="space-y-2">
      {data.map((plan) => {
        const g = GRANULARITY_LABEL[plan.granularity];
        return (
          <li key={plan.id}>
            <Link
              href={`/p/${plan.id}`}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-all hover:border-border-strong hover:shadow-card"
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[11px] font-bold text-fg-muted"
                title={`${g.full} · ${plan.node_count} nodes`}
              >
                {g.short}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-fg">{plan.title}</p>
                <p className="truncate text-xs text-fg-muted">{plan.prompt}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="hidden text-[11px] text-fg-muted sm:inline">{plan.node_count} nodes</span>
                <StatusPill status={normalizePlanStatus(plan.status)} size="sm" />
                <span className="hidden text-[11px] text-fg-muted md:inline">{timeAgo(plan.updated_at)}</span>
                <ArrowUpRight size={15} className="text-fg-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Map PlanStatus → a NodeStatus pill tone for a compact at-a-glance signal.
function normalizePlanStatus(s: string): "ready" | "running" | "built" | "merged" | "failed" | "pending" {
  switch (s) {
    case "executing":
      return "running";
    case "ready":
      return "ready";
    case "merged":
      return "merged";
    case "partially_merged":
      return "built";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

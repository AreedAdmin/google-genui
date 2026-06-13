"use client";

import * as React from "react";
import type { PlanGraph, PlanNode } from "@trellis/shared";
import { Sheet } from "@/components/ui/overlay";
import { Button, IconButton, StatusPill, ChangeTypeBadge, ConfidenceMeter } from "@/components/ui/primitives";
import { WidgetSpecList, hasRenderableWidget } from "@/components/widgets/registry";
import {
  ChangesSection,
  AssumptionsSection,
  AnalysisSection,
  BenefitsSection,
  NotableSymbolsSection,
} from "./Sections";
import { RunLog } from "./RunLog";
import { NodeDiff } from "./NodeDiff";
import { ShareDialog, DelegateDialog, AddContextDialog } from "./ActionDialogs";
import { indexPlan, falseIndependenceRefs, shortRef } from "@/lib/utils";
import { branchTint } from "@/lib/design";
import { Play, Share2, GitFork, Plus, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Node Inspector (node-inspector.md). Right-hand drawer: header (change_type ·
 * title · status · branch · confidence), action bar (Run / Share / Delegate /
 * Add context), the change-type WidgetSpec(s) from the trusted registry, and the
 * five grounded sections as tabs. Default tab comes from
 * LayoutSpec.default_inspector_tab — never hard-coded.
 */

type SectionTab = "changes" | "assumptions" | "analysis" | "benefits" | "notable";

const TAB_LABELS: Record<SectionTab, string> = {
  changes: "Changes",
  assumptions: "Assumptions",
  analysis: "Analysis",
  benefits: "Benefits",
  notable: "Notable",
};

/**
 * LayoutSpec.default_inspector_tab → the section tab that opens. "contract"
 * means "emphasize the change-type widget" (which is already at the top), so the
 * section list defaults to Changes beneath it.
 */
function defaultSectionTab(t: string | undefined): SectionTab {
  switch (t) {
    case "assumptions":
      return "assumptions";
    case "analysis":
      return "analysis";
    case "changes":
    case "contract":
    default:
      return "changes";
  }
}

export function NodeInspector({
  graph,
  nodeId,
  onClose,
  onRun,
}: {
  graph: PlanGraph;
  nodeId: string | null;
  onClose: () => void;
  onRun: (id: string) => void;
}) {
  const idx = React.useMemo(() => indexPlan(graph), [graph]);
  const liveNode = nodeId ? idx.nodeById.get(nodeId) ?? null : null;

  // Retain the last node during the slide-out close animation.
  const [lastNode, setLastNode] = React.useState<PlanNode | null>(null);
  React.useEffect(() => {
    if (liveNode) setLastNode(liveNode);
  }, [liveNode]);
  const node = liveNode ?? lastNode;
  const annotation = node ? idx.annotationByNode.get(node.id) : undefined;

  const layoutSpec = graph.plan.layout_spec;
  const defaultTab = defaultSectionTab(layoutSpec?.default_inspector_tab);

  const [tab, setTab] = React.useState<SectionTab>(defaultTab);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [delegateOpen, setDelegateOpen] = React.useState(false);
  const [contextOpen, setContextOpen] = React.useState(false);

  // Re-bind tab to the layout default whenever a new node opens.
  React.useEffect(() => {
    if (nodeId) setTab(defaultTab);
  }, [nodeId, defaultTab]);

  const onJump = React.useCallback((ref: string) => {
    // In the MVP, "jump to symbol" surfaces the ref in the Notable tab / diff.
    // eslint-disable-next-line no-console
    console.info("[inspector] jump to", ref);
  }, []);

  const open = Boolean(nodeId);

  return (
    <>
      <Sheet open={open} onClose={onClose} label="Node inspector" width={480}>
        {node && (
          <div className="flex h-full flex-col">
            <InspectorHeader graph={graph} node={node} onClose={onClose} />

            {/* Action bar (§3) */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={13} />}
                disabled={!(node.status === "ready" || node.status === "failed")}
                onClick={() => onRun(node.id)}
              >
                Run
              </Button>
              <Button variant="secondary" size="sm" icon={<Share2 size={13} />} onClick={() => setShareOpen(true)}>
                Share
              </Button>
              <Button variant="secondary" size="sm" icon={<GitFork size={13} />} onClick={() => setDelegateOpen(true)}>
                Delegate subtree
              </Button>
              <Button variant="ghost" size="sm" icon={<Plus size={13} />} onClick={() => setContextOpen(true)}>
                Add context
              </Button>
            </div>

            <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-4">
              {/* Live run log while running */}
              <RunLog nodeId={node.id} />

              {/* Change-type widget(s) from the trusted registry (§4) */}
              {hasRenderableWidget(annotation?.widget_specs) ? (
                <WidgetSpecList specs={annotation?.widget_specs ?? []} onJump={onJump} />
              ) : annotation?.widget_specs && annotation.widget_specs.length > 0 ? (
                <WidgetSpecList specs={annotation.widget_specs} onJump={onJump} />
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-4 text-center text-xs text-fg-muted">
                  No change-type widget for this node yet.
                </div>
              )}

              {/* Section tabs (§2) */}
              <div className="rounded-lg border border-border bg-surface">
                <div role="tablist" className="scroll-thin flex gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5">
                  {(["changes", "assumptions", "analysis", "benefits", "notable"] as SectionTab[]).map((t) => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                        tab === t ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg",
                      )}
                    >
                      {TAB_LABELS[t]}
                      {t === "analysis" && (annotation?.analysis.length ?? 0) > 0 && (
                        <span className="ml-1 text-fg-muted">{annotation?.analysis.length}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="p-3.5">
                  {tab === "changes" && (
                    <div className="space-y-3">
                      <ChangesSection node={node} onJump={onJump} />
                      <NodeDiff nodeId={node.id} status={node.status} />
                    </div>
                  )}
                  {tab === "assumptions" && <AssumptionsSection annotation={annotation} nodeId={node.id} onJump={onJump} />}
                  {tab === "analysis" && <AnalysisSection annotation={annotation} nodeId={node.id} onJump={onJump} />}
                  {tab === "benefits" && <BenefitsSection annotation={annotation} nodeId={node.id} onJump={onJump} />}
                  {tab === "notable" && <NotableSymbolsSection annotation={annotation} onJump={onJump} />}
                </div>
              </div>

              <p className="px-1 pb-2 text-center text-[10px] text-fg-muted">
                rendered from a validated spec · revision {node.revision}
              </p>
            </div>
          </div>
        )}
      </Sheet>

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} planId={graph.plan.id} />
      <DelegateDialog open={delegateOpen} onClose={() => setDelegateOpen(false)} planId={graph.plan.id} node={node} />
      <AddContextDialog open={contextOpen} onClose={() => setContextOpen(false)} planId={graph.plan.id} />
    </>
  );
}


function InspectorHeader({ graph, node, onClose }: { graph: PlanGraph; node: PlanNode; onClose: () => void }) {
  const idx = indexPlan(graph);
  const branch = node.branch_id ? idx.branchById.get(node.branch_id) : null;
  const branchIndex = node.branch_id ? idx.branchIndex.get(node.branch_id) ?? null : null;
  const tint = branchIndex !== null ? branchTint(branchIndex) : null;
  const flagged = falseIndependenceRefs(graph, node.id);

  return (
    <header className="border-b border-border px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <ChangeTypeBadge changeType={node.change_type} />
          <h2 className="mt-0.5 text-base font-semibold leading-tight text-fg">{node.title}</h2>
        </div>
        <IconButton label="Close inspector" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusPill status={node.status} size="sm" />
        {branch && (
          <span className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: tint ?? "var(--border-strong)" }} aria-hidden />
            {branch.label}
            {branch.independent_of.length > 0 && <span title="proven parallel-safe">· ∥ independent</span>}
          </span>
        )}
        <span className="ml-auto">
          <ConfidenceMeter value={node.confidence} showNumber />
        </span>
      </div>
      {flagged.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--st-blocked)_40%,var(--border))] bg-[color-mix(in_srgb,var(--st-blocked)_8%,transparent)] px-2 py-1.5 text-[11px] text-[var(--st-blocked)]">
          <AlertTriangle size={12} aria-hidden />
          <span>
            False independence — shares <span className="font-mono">{flagged.map(shortRef).join(", ")}</span> with another &ldquo;independent&rdquo; branch.
          </span>
        </div>
      )}
    </header>
  );
}

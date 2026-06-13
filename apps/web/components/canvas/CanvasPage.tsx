"use client";

import * as React from "react";
import Link from "next/link";
import { usePlanGraph, useRunNodes } from "@/lib/hooks";
import { useCanvasStore } from "@/lib/store";
import { subscribeRunStream } from "@/lib/api";
import { useAgentStream } from "@/lib/agui";
import { GraphCanvas } from "./GraphCanvas";
import { CanvasToolbar } from "./CanvasToolbar";
import { SelectionBanner } from "./SelectionBanner";
import { NodeInspector } from "@/components/inspector/NodeInspector";
import { ShareDialog, AddContextDialog } from "@/components/inspector/ActionDialogs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Skeleton, EmptyState, Button } from "@/components/ui/primitives";
import { GitBranch, ArrowLeft, AlertCircle } from "lucide-react";

/**
 * The canvas page (/p/[id]). Fetches the PlanGraph, renders the layout-adaptive
 * canvas + inspector, and wires Run / Dispatch parallel to the API + live SSE
 * run streams (graph-canvas.md §6/§7).
 */
export function CanvasPage({ planId }: { planId: string }) {
  const { data: graph, isLoading, isError } = usePlanGraph(planId);
  const runMutation = useRunNodes(planId);
  // AG-UI: stream the agent's plan/run state onto the canvas (headless CopilotKit;
  // mandated-integrations.md §3.1). Additive — durable truth still flows via React Query.
  useAgentStream(planId);

  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const selectNode = useCanvasStore((s) => s.selectNode);
  const multiSelection = useCanvasStore((s) => s.multiSelection);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const setRunProgress = useCanvasStore((s) => s.setRunProgress);
  const appendRunLog = useCanvasStore((s) => s.appendRunLog);
  const reset = useCanvasStore((s) => s.reset);

  const [shareOpen, setShareOpen] = React.useState(false);
  const [contextOpen, setContextOpen] = React.useState(false);
  const streamCleanups = React.useRef<Map<string, () => void>>(new Map());

  React.useEffect(() => {
    reset();
    return () => {
      streamCleanups.current.forEach((fn) => fn());
      streamCleanups.current.clear();
    };
  }, [planId, reset]);

  // Subscribe a run's SSE stream → drive the live overlay on its node.
  const attachStream = React.useCallback(
    (run: { run_id: string; node_id: string | null }) => {
      const nodeId = run.node_id;
      if (!nodeId) return;
      setRunProgress(nodeId, { runId: run.run_id, status: "running", progress: 0.05 });
      streamCleanups.current.get(nodeId)?.();
      const cleanup = subscribeRunStream(run.run_id, {
        onEvent: (e) => {
          if (e.type === "status" && typeof e.data?.progress === "number") {
            setRunProgress(nodeId, { runId: run.run_id, status: "running", progress: e.data.progress as number, tokens: (e.data.tokens as number) ?? 0 });
          } else if (e.type === "text" && typeof e.data?.text === "string") {
            appendRunLog(nodeId, e.data.text as string);
          } else if (e.type === "tool_call" && typeof e.data?.name === "string") {
            appendRunLog(nodeId, `→ ${e.data.name as string}`);
          } else if (e.type === "file_edit" && typeof e.data?.path === "string") {
            appendRunLog(nodeId, `± ${e.data.path as string}`);
          }
        },
        onDone: () => setRunProgress(nodeId, { runId: run.run_id, status: "succeeded", progress: 1 }),
        onError: () => setRunProgress(nodeId, { runId: run.run_id, status: "failed", progress: 1 }),
      });
      streamCleanups.current.set(nodeId, cleanup);
    },
    [setRunProgress, appendRunLog],
  );

  const runNodes = React.useCallback(
    (nodeIds: string[]) => {
      runMutation.mutate(
        { node_ids: nodeIds },
        {
          onSuccess: (res) => res.runs.forEach(attachStream),
        },
      );
    },
    [runMutation, attachStream],
  );

  const runAll = React.useCallback(() => {
    if (!graph) return;
    const ready = graph.nodes.filter((n) => n.status === "ready").map((n) => n.id);
    runNodes(ready.length ? ready : graph.nodes.map((n) => n.id));
  }, [graph, runNodes]);

  const dispatchParallel = React.useCallback(() => {
    if (!graph) return;
    // proven-independent branches → all their nodes
    const indepBranches = graph.branches.filter((b) => b.independent_of.length > 0);
    const ids = indepBranches.flatMap((b) => b.node_ids);
    runNodes(ids.length ? ids : graph.nodes.filter((n) => n.status === "ready").map((n) => n.id));
  }, [graph, runNodes]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      <TopBar />
      {isLoading ? (
        <div className="flex flex-1 flex-col gap-3 p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="flex-1" />
        </div>
      ) : isError || !graph ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState
            icon={<AlertCircle size={24} />}
            title="Couldn't load this plan"
            hint="The plan may not exist, or the API is unreachable."
            action={
              <Link href="/">
                <Button variant="secondary" icon={<ArrowLeft size={14} />}>
                  Back home
                </Button>
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <CanvasToolbar
            title={graph.plan.title}
            granularity={graph.plan.granularity}
            layoutSpec={graph.plan.layout_spec}
            nodeCount={graph.nodes.length}
            running={runMutation.isPending}
            onRunAll={runAll}
            onDispatchParallel={dispatchParallel}
            onAddContext={() => setContextOpen(true)}
            onShare={() => setShareOpen(true)}
          />

          <div className="relative flex-1">
            <GraphCanvas graph={graph} onOpenNode={selectNode} onRunNode={(id) => runNodes([id])} />
            <SelectionBanner graph={graph} selection={multiSelection} running={runMutation.isPending} onDispatch={runNodes} onClear={clearSelection} />
          </div>

          <NodeInspector graph={graph} nodeId={selectedNodeId} onClose={() => selectNode(null)} onRun={(id) => runNodes([id])} />
          <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} planId={planId} />
          <AddContextDialog open={contextOpen} onClose={() => setContextOpen(false)} planId={planId} />
        </>
      )}
    </div>
  );
}

function TopBar() {
  return (
    <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
      <Link href="/" className="flex items-center gap-2 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft size={15} />
        <span className="flex items-center gap-1.5 font-semibold text-fg">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-primary text-primary-fg">
            <GitBranch size={12} />
          </span>
          Trellis
        </span>
      </Link>
      <ThemeToggle />
    </div>
  );
}

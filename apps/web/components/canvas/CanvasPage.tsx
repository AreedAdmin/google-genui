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
import { PlanCopilot } from "./PlanCopilot";
import { NodeInspector } from "@/components/inspector/NodeInspector";
import { ShareDialog, AddContextDialog } from "@/components/inspector/ActionDialogs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Skeleton, EmptyState, Button } from "@/components/ui/primitives";
import { GitBranch, ArrowLeft, AlertCircle, GitFork } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { PruneShareDialog } from "./PruneShareDialog";

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

  // Delegation: a ?subtree=<ids> link scopes the canvas to just those nodes.
  const searchParams = useSearchParams();
  const subtreeParam = searchParams.get("subtree");
  const subtreeIds = React.useMemo(
    () => (subtreeParam ? subtreeParam.split(",").map((s) => s.trim()).filter(Boolean) : null),
    [subtreeParam],
  );
  const viewGraph = React.useMemo(() => {
    if (!graph || !subtreeIds || subtreeIds.length === 0) return graph;
    const ids = new Set(subtreeIds);
    const nodes = graph.nodes.filter((n) => ids.has(n.id));
    const edges = graph.edges.filter((e) => ids.has(e.from_node) && ids.has(e.to_node));
    const branchIds = new Set(nodes.map((n) => n.branch_id).filter(Boolean));
    const branches = graph.branches.filter((b) => branchIds.has(b.id));
    return { ...graph, nodes, edges, branches };
  }, [graph, subtreeIds]);

  // Prune → generate a shareable subtree link.
  const [prune, setPrune] = React.useState<{ link: string; count: number } | null>(null);
  const handlePrune = React.useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setPrune({ link: `${origin}/p/${planId}?subtree=${ids.join(",")}`, count: ids.length });
      clearSelection();
    },
    [planId, clearSelection],
  );

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

      // The runner emits no explicit progress %, so advance a heuristic bar as
      // events arrive; the terminal `status` event pins it to 100%.
      let ticks = 1;
      let tokens = 0;
      let final: "succeeded" | "failed" | null = null;
      const isDone = (s?: string) => !!s && /built|merged|success|succeeded|done|complete/i.test(s);
      const isFail = (s?: string) => !!s && /fail|error|blocked|abort/i.test(s);
      const bump = () => {
        ticks += 1;
        setRunProgress(nodeId, {
          runId: run.run_id,
          status: "running",
          progress: Math.min(0.92, 0.05 + ticks * 0.035),
          tokens,
        });
      };

      const cleanup = subscribeRunStream(run.run_id, {
        onEvent: (e) => {
          const d = (e.data ?? {}) as Record<string, unknown>;
          if (typeof d.tokens === "number") tokens = d.tokens;

          switch (e.type) {
            case "text": {
              const t = ((d.text as string) ?? (d.stderr as string) ?? "").trim();
              if (t) {
                appendRunLog(nodeId, t);
                bump();
              }
              break;
            }
            case "tool_call":
              appendRunLog(nodeId, `→ ${(d.tool as string) ?? "tool"}`);
              bump();
              break;
            case "file_edit":
              appendRunLog(nodeId, `± ${(d.path as string) ?? "file"}`);
              bump();
              break;
            case "token_usage":
              bump();
              break;
            case "error":
              appendRunLog(nodeId, `⚠ ${(d.message as string) ?? "error"}`);
              final = "failed";
              setRunProgress(nodeId, { runId: run.run_id, status: "failed", tokens });
              break;
            case "status": {
              const state = (d.state as string) ?? (d.result as string);
              if (isDone(state)) {
                final = "succeeded";
                appendRunLog(nodeId, `· ${state}`);
                setRunProgress(nodeId, { runId: run.run_id, status: "succeeded", progress: 1, tokens });
              } else if (isFail(state)) {
                final = "failed";
                appendRunLog(nodeId, `· ${state}`);
                setRunProgress(nodeId, { runId: run.run_id, status: "failed", progress: 1, tokens });
              } else if (state && !/running|starting|queued/i.test(state)) {
                appendRunLog(nodeId, `· ${state}`);
                bump();
              }
              break;
            }
          }
        },
        // The relay tails Redis with XREAD BLOCK (never closes on completion), so a
        // disconnect is only terminal-meaningful if we already saw a final status.
        onDone: () =>
          setRunProgress(nodeId, { runId: run.run_id, status: final ?? "succeeded", progress: 1, tokens }),
        onError: () => {
          if (final) setRunProgress(nodeId, { runId: run.run_id, status: final, progress: 1, tokens });
        },
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
    if (!viewGraph) return;
    const ready = viewGraph.nodes.filter((n) => n.status === "ready").map((n) => n.id);
    runNodes(ready.length ? ready : viewGraph.nodes.map((n) => n.id));
  }, [viewGraph, runNodes]);

  const dispatchParallel = React.useCallback(() => {
    if (!viewGraph) return;
    // proven-independent branches → all their nodes
    const indepBranches = viewGraph.branches.filter((b) => b.independent_of.length > 0);
    const ids = indepBranches.flatMap((b) => b.node_ids);
    runNodes(ids.length ? ids : viewGraph.nodes.filter((n) => n.status === "ready").map((n) => n.id));
  }, [viewGraph, runNodes]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      <TopBar />
      {/* Plan-iteration copilot (mandate's sanctioned chat use). Rendered
          unconditionally so its CopilotKit hooks stay stable across load states. */}
      <PlanCopilot planId={planId} graph={graph} selectedNodeId={selectedNodeId} />
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
            nodeCount={viewGraph!.nodes.length}
            running={runMutation.isPending}
            onRunAll={runAll}
            onDispatchParallel={dispatchParallel}
            onAddContext={() => setContextOpen(true)}
            onShare={() => setShareOpen(true)}
          />

          {subtreeIds && (
            <div className="flex items-center gap-2 border-b border-border bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] px-4 py-1.5 text-xs">
              <GitFork size={13} className="text-accent" aria-hidden />
              <span className="font-medium text-fg">Delegated subtree</span>
              <span className="truncate text-fg-muted">
                · {viewGraph!.nodes.length} task{viewGraph!.nodes.length === 1 ? "" : "s"} from “{graph.plan.title}”. Run these and report back.
              </span>
              <Link href={`/p/${planId}`} className="ml-auto whitespace-nowrap text-accent hover:underline">
                View full plan →
              </Link>
            </div>
          )}
          <div className="relative flex-1">
            <GraphCanvas graph={viewGraph!} onOpenNode={selectNode} onRunNode={(id) => runNodes([id])} />
            <SelectionBanner graph={viewGraph!} selection={multiSelection} running={runMutation.isPending} onDispatch={runNodes} onPrune={handlePrune} onClear={clearSelection} />
          </div>

          <NodeInspector graph={viewGraph!} nodeId={selectedNodeId} onClose={() => selectNode(null)} onRun={(id) => runNodes([id])} />
          <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} planId={planId} />
          <AddContextDialog open={contextOpen} onClose={() => setContextOpen(false)} planId={planId} />
          <PruneShareDialog open={!!prune} onClose={() => setPrune(null)} link={prune?.link ?? ""} count={prune?.count ?? 0} />
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

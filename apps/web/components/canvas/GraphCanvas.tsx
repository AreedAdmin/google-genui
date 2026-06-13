"use client";

import * as React from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  SelectionMode,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { PlanGraph } from "@trellis/shared";
import { computeLayout, type LaneBand } from "@/lib/layout";
import { PlanNodeView, SuperNodeView, type PlanNodeData } from "./PlanNodeView";
import { PlanEdgeView, type PlanEdgeData } from "./PlanEdgeView";
import { useCanvasStore } from "@/lib/store";
import { branchTint } from "@/lib/design";
import { indexPlan } from "@/lib/utils";
import { EmptyState } from "@/components/ui/primitives";
import { PlanGenerating } from "./PlanGenerating";
import { Boxes, AlertTriangle } from "lucide-react";

const nodeTypes = { planNode: PlanNodeView, superNode: SuperNodeView };
const edgeTypes = { planEdge: PlanEdgeView };

/**
 * GraphCanvas (graph-canvas.md). Renders a PlanGraph via React Flow, selecting
 * the layout strategy from LayoutSpec.canvas, with swimlane bands (G3), a
 * minimap (G4), and live node selection / open-inspector wiring.
 */

function Inner({
  graph,
  onOpenNode,
  onRunNode,
}: {
  graph: PlanGraph;
  onOpenNode: (id: string) => void;
  onRunNode: (id: string) => void;
}) {
  const canvas = graph.plan.layout_spec?.canvas ?? "compact_dag";
  const hideSoftEdges = useCanvasStore((s) => s.hideSoftEdges);
  const selectedNodeId = useCanvasStore((s) => s.selectedNodeId);
  const setMultiSelection = useCanvasStore((s) => s.setMultiSelection);
  const runProgress = useCanvasStore((s) => s.runProgress);
  const { fitView } = useReactFlow();

  const layout = React.useMemo(
    () => computeLayout(graph, canvas, { hideSoftEdges }),
    [graph, canvas, hideSoftEdges],
  );

  // Inject live progress + interaction callbacks into node data.
  const nodes: Node<PlanNodeData>[] = React.useMemo(
    () =>
      layout.nodes.map((n) => {
        const prog = runProgress[n.id];
        return {
          ...n,
          selected: n.id === selectedNodeId,
          data: {
            ...n.data,
            nodeStatus: prog && prog.status === "running" ? "running" : n.data.nodeStatus,
            progress: prog?.progress,
            onRun: onRunNode,
            onOpen: onOpenNode,
          },
        };
      }),
    [layout.nodes, runProgress, selectedNodeId, onRunNode, onOpenNode],
  );

  const edges: Edge<PlanEdgeData>[] = layout.edges;

  const onNodeClick: NodeMouseHandler = React.useCallback(
    (_e, node) => onOpenNode(node.id),
    [onOpenNode],
  );

  const onSelectionChange: OnSelectionChangeFunc = React.useCallback(
    ({ nodes: sel }) => setMultiSelection(sel.map((n) => n.id)),
    [setMultiSelection],
  );

  React.useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.18, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [canvas, graph.plan.id, fitView]);

  const showMinimap = canvas === "hierarchical_map";
  const idx = indexPlan(graph);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={onNodeClick}
      onSelectionChange={onSelectionChange}
      fitView
      minZoom={0.2}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: "planEdge" }}
      className="bg-bg"
      selectionMode={SelectionMode.Partial}
      selectionOnDrag
      panOnDrag={[1, 2]}
      panOnScroll
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
      {/* Swimlane bands behind nodes (G3). */}
      {layout.lanes.length > 0 && <SwimlaneBands lanes={layout.lanes} width={layout.width} graph={graph} />}
      <Controls showInteractive={false} />
      {showMinimap && (
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const node = idx.nodeById.get(n.id);
            const bi = node?.branch_id ? idx.branchIndex.get(node.branch_id) : null;
            return bi != null ? branchTint(bi) : "var(--border-strong)";
          }}
          maskColor="color-mix(in srgb, var(--bg) 70%, transparent)"
        />
      )}
    </ReactFlow>
  );
}

/** Swimlane band overlay drawn in flow coordinates (G3). */
function SwimlaneBands({ lanes, width, graph }: { lanes: LaneBand[]; width: number; graph: PlanGraph }) {
  const { getViewport } = useReactFlow();
  const [, force] = React.useReducer((x) => x + 1, 0);
  const vp = getViewport();

  // Re-render bands as the viewport moves so they track the flow transform.
  React.useEffect(() => {
    const id = setInterval(force, 120);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: "0 0" }}>
        {lanes.map((lane, i) => {
          const tint = graph.branches.findIndex((b) => b.label === lane.key);
          const color = tint >= 0 ? branchTint(tint) : "var(--border-strong)";
          return (
            <div key={lane.key} className="absolute" style={{ top: lane.y, left: 0, width: Math.max(width, 720) + 120, height: lane.height }}>
              <div
                className="absolute inset-0 rounded-md"
                style={{ background: i % 2 === 0 ? "color-mix(in srgb, var(--surface-2) 40%, transparent)" : "transparent", borderLeft: `3px solid ${color}` }}
              />
              <div className="absolute left-2 top-2 flex max-w-[220px] items-start gap-1.5 rounded bg-surface px-2 py-0.5 text-[11px] font-semibold uppercase leading-tight tracking-wide" style={{ color }}>
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                <span className="line-clamp-2 whitespace-normal break-words">{lane.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GraphCanvas(props: {
  graph: PlanGraph;
  onOpenNode: (id: string) => void;
  onRunNode: (id: string) => void;
}) {
  if (props.graph.nodes.length === 0) {
    const status = props.graph.plan?.status;
    // Still being built by the worker → show the generating animation, NOT the
    // terminal "no changes" state (which only applies once the plan is ready).
    if (status === "planning" || status === "draft") {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <PlanGenerating title={props.graph.plan?.title} />
        </div>
      );
    }
    if (status === "failed") {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <EmptyState
            icon={<AlertTriangle size={24} />}
            title="Planning failed"
            hint="The planner couldn't build this plan. Check the worker logs, or add context and re-plan."
          />
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState icon={<Boxes size={24} />} title="No changes needed" hint="The planner found nothing to do for this prompt — here's why it's already satisfied." />
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

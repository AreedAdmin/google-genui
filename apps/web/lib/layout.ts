import type { Node, Edge } from "@xyflow/react";
import { MarkerType, Position } from "@xyflow/react";
import type { PlanGraph, LayoutSpec, CanvasKind } from "@trellis/shared";
import { layoutWithDagre, boundingBox, NODE_W, NODE_H } from "./dagre";
import { indexPlan, falseIndependenceRefs } from "./utils";
import { edgeVisual } from "./design";
import type { PlanNodeData } from "@/components/canvas/PlanNodeView";
import type { PlanEdgeData } from "@/components/canvas/PlanEdgeView";

/**
 * The layout engine (graph-canvas.md §5). A pure strategy per LayoutSpec.canvas:
 * (nodes, edges, LayoutSpec) → positioned React Flow nodes + edges + frame
 * chrome. Deterministic-from-spec: same inputs → same layout. Strategies:
 *   - checklist        (G1) — single vertical column, DAG collapsed
 *   - compact_dag      (G2) — dagre LR/TB
 *   - swimlane_dag     (G3) — lanes grouped by module, dagre per lane
 *   - hierarchical_map (G4) — clustered super-nodes, dagre across clusters
 */

const LANE_GAP = 40;
const LANE_LABEL_W = 96;
const CHECKLIST_GAP = 28;
/** Clear strip reserved at the top of each lane for its (possibly wrapped) label. */
const LANE_HEADER = 40;

export interface LaneBand {
  key: string;
  label: string;
  y: number;
  height: number;
}

export interface LayoutResult {
  nodes: Node<PlanNodeData>[];
  edges: Edge<PlanEdgeData>[];
  lanes: LaneBand[];
  width: number;
  height: number;
}

/** Derive a stable module key for swimlane grouping (graph-canvas.md §5). */
function moduleKey(graph: PlanGraph, nodeId: string): string {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return "other";
  // Prefer the branch label (the planner groups lanes by branch for G3),
  // else the first path segment of the first touched file.
  const branch = graph.branches.find((b) => b.id === node.branch_id);
  if (branch?.label) return branch.label;
  const file = node.touch_set.resolved?.files?.[0] ?? node.touch_set.predicted.modify[0]?.file ?? node.touch_set.predicted.add[0]?.file;
  if (file) {
    const seg = file.split("/");
    return seg[0] === "src" && seg[1] ? seg[1] : (seg[0] ?? "other");
  }
  return "other";
}

function buildNode(
  graph: PlanGraph,
  nodeId: string,
  emphasis: string[],
  isSuperNode: boolean,
): Node<PlanNodeData> {
  const idx = indexPlan(graph);
  const node = idx.nodeById.get(nodeId)!;
  const branch = node.branch_id ? idx.branchById.get(node.branch_id) : null;
  const branchIndex = node.branch_id ? (idx.branchIndex.get(node.branch_id) ?? null) : null;

  return {
    id: nodeId,
    type: isSuperNode ? "superNode" : "planNode",
    position: { x: 0, y: 0 },
    width: NODE_W,
    height: NODE_H,
    data: {
      title: node.title,
      changeType: node.change_type,
      nodeStatus: node.status,
      confidence: node.confidence,
      emphasis,
      branchLabel: branch?.label ?? null,
      branchIndex,
      branchIndependent: (branch?.independent_of.length ?? 0) > 0,
      falseIndependenceRefs: falseIndependenceRefs(graph, nodeId),
      isSuperNode,
      granularity: node.granularity,
    },
  };
}

function buildEdges(graph: PlanGraph, hideSoftEdges: boolean): Edge<PlanEdgeData>[] {
  return graph.edges
    .filter((e) => !(hideSoftEdges && e.type === "soft_order"))
    // Only render edges backed by REAL overlap (shared file / symbol / signature).
    // overlap_score === 0 edges are the planner's ungrounded coarse-order hints —
    // dropping them lets non-overlapping nodes fall into separate, independent
    // subtrees (consistent with the engine's "overlap 0 = safe to parallelize").
    .filter((e) => (e.overlap_score ?? 0) > 0)
    .map((e) => {
      const v = edgeVisual(e.type);
      return {
        id: e.id,
        source: e.from_node,
        target: e.to_node,
        type: "planEdge",
        markerEnd: v.arrow ? { type: MarkerType.ArrowClosed, width: 16, height: 16, color: e.overlap_score > 0 ? "var(--st-blocked)" : `var(${v.strokeVar})` } : undefined,
        data: {
          edgeType: e.type,
          rationale: e.rationale,
          evidence: e.evidence,
          overlapScore: e.overlap_score,
        },
        ariaLabel: `${e.type} edge`,
      } satisfies Edge<PlanEdgeData>;
    });
}

// ---- checklist (G1) ----

function layoutChecklist(graph: PlanGraph, spec: LayoutSpec): LayoutResult {
  const nodes = graph.nodes.map((n, i) => {
    const node = buildNode(graph, n.id, spec.emphasis, false);
    node.position = { x: 0, y: i * (NODE_H + CHECKLIST_GAP) };
    node.sourcePosition = Position.Bottom;
    node.targetPosition = Position.Top;
    return node;
  });
  const bb = boundingBox(nodes);
  return { nodes, edges: buildEdges(graph, false), lanes: [], width: bb.maxX, height: bb.maxY };
}

// ---- compact_dag (G2) ----

function layoutCompactDag(graph: PlanGraph, spec: LayoutSpec, hideSoftEdges: boolean): LayoutResult {
  const rawNodes = graph.nodes.map((n) => buildNode(graph, n.id, spec.emphasis, false));
  const edges = buildEdges(graph, hideSoftEdges);
  const positioned = layoutWithDagre(rawNodes, edges, { direction: spec.direction });
  const bb = boundingBox(positioned);
  return { nodes: positioned as Node<PlanNodeData>[], edges, lanes: [], width: bb.maxX - bb.minX, height: bb.maxY - bb.minY };
}

// ---- swimlane_dag (G3) ----

function layoutSwimlane(graph: PlanGraph, spec: LayoutSpec, hideSoftEdges: boolean): LayoutResult {
  // Group node ids by module key, preserving first-seen lane order.
  const laneOrder: string[] = [];
  const laneNodes = new Map<string, string[]>();
  for (const n of graph.nodes) {
    const key = moduleKey(graph, n.id);
    if (!laneNodes.has(key)) {
      laneNodes.set(key, []);
      laneOrder.push(key);
    }
    laneNodes.get(key)!.push(n.id);
  }

  const edges = buildEdges(graph, hideSoftEdges);
  const allNodes: Node<PlanNodeData>[] = [];
  const lanes: LaneBand[] = [];
  let cursorY = 0;

  for (const key of laneOrder) {
    const ids = laneNodes.get(key)!;
    // Lay out this lane horizontally with dagre, restricted to its own edges.
    const laneRaw = ids.map((id) => buildNode(graph, id, spec.emphasis, false));
    const laneEdges = edges.filter((e) => ids.includes(e.source) && ids.includes(e.target));
    const positioned = layoutWithDagre(laneRaw, laneEdges, { direction: "LR", offsetX: LANE_LABEL_W });

    const bb = boundingBox(positioned);
    const contentHeight = Math.max(NODE_H, bb.maxY - bb.minY);
    // Reserve a header strip at the top of each lane for its label so nodes
    // never cover the lane name.
    const laneHeight = LANE_HEADER + contentHeight + 16;
    // Re-base lane vertically into its band, below the header strip.
    const shifted = positioned.map((node) => ({
      ...node,
      position: { x: node.position.x, y: node.position.y - bb.minY + cursorY + LANE_HEADER + 8 },
    })) as Node<PlanNodeData>[];

    allNodes.push(...shifted);
    lanes.push({ key, label: key, y: cursorY, height: laneHeight });
    cursorY += laneHeight + LANE_GAP;
  }

  const bb = boundingBox(allNodes);
  return { nodes: allNodes, edges, lanes, width: Math.max(bb.maxX, 720), height: cursorY };
}

// ---- hierarchical_map (G4) ----

function layoutHierarchical(graph: PlanGraph, spec: LayoutSpec, hideSoftEdges: boolean): LayoutResult {
  // The G4 fixture stores clusters as top-level nodes; render each as a super-node.
  const rawNodes = graph.nodes.map((n) => buildNode(graph, n.id, spec.emphasis, true));
  // widen super-nodes
  for (const n of rawNodes) {
    n.width = 220;
    n.height = 110;
  }
  const edges = buildEdges(graph, hideSoftEdges);
  const positioned = layoutWithDagre(rawNodes, edges, { direction: spec.direction, nodeWidth: 220, nodeHeight: 110, rankSep: 120, nodeSep: 64 });
  const bb = boundingBox(positioned);
  return { nodes: positioned as Node<PlanNodeData>[], edges, lanes: [], width: bb.maxX - bb.minX, height: bb.maxY - bb.minY };
}

export function computeLayout(
  graph: PlanGraph,
  canvas: CanvasKind,
  opts: { hideSoftEdges?: boolean } = {},
): LayoutResult {
  const spec: LayoutSpec =
    graph.plan.layout_spec ?? {
      tier: graph.plan.granularity,
      canvas,
      direction: "LR",
      grouping: null,
      emphasis: [],
      parallelism_ui: "branch_buttons",
      delegation_ui: "per_branch",
      semantic_zoom: false,
      default_inspector_tab: "changes",
    };
  const hideSoftEdges = opts.hideSoftEdges ?? false;

  switch (canvas) {
    case "checklist":
      return layoutChecklist(graph, spec);
    case "swimlane_dag":
      return layoutSwimlane(graph, spec, hideSoftEdges);
    case "hierarchical_map":
      return layoutHierarchical(graph, spec, hideSoftEdges);
    case "compact_dag":
    default:
      return layoutCompactDag(graph, spec, hideSoftEdges);
  }
}

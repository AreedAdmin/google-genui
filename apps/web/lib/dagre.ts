import dagre from "dagre";
import { Position, type Edge, type Node } from "@xyflow/react";

/**
 * Pure dagre layout helper. Given React Flow nodes + edges, returns nodes with
 * computed { x, y } positions. Deterministic-from-spec (genui-philosophy.md §5.3):
 * same inputs → same layout. Used by compact_dag and as the per-lane engine for
 * swimlane_dag.
 */

export interface DagreOptions {
  direction?: "LR" | "TB";
  nodeWidth?: number;
  nodeHeight?: number;
  /** rank separation (between layers). */
  rankSep?: number;
  /** node separation (within a layer). */
  nodeSep?: number;
  /** Optional offset applied to every position (for lane stacking). */
  offsetX?: number;
  offsetY?: number;
}

export const NODE_W = 248;
export const NODE_H = 96;

export function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
  opts: DagreOptions = {},
): Node[] {
  const {
    direction = "LR",
    nodeWidth = NODE_W,
    nodeHeight = NODE_H,
    rankSep = 96,
    nodeSep = 40,
    offsetX = 0,
    offsetY = 0,
  } = opts;

  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: rankSep,
    nodesep: nodeSep,
    marginx: 16,
    marginy: 16,
  });

  for (const node of nodes) {
    g.setNode(node.id, {
      width: (node.width as number) ?? nodeWidth,
      height: (node.height as number) ?? nodeHeight,
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  const isHorizontal = direction === "LR";

  return nodes.map((node) => {
    const pos = g.node(node.id) as { x?: number; y?: number } | undefined;
    const w = (node.width as number) ?? nodeWidth;
    const h = (node.height as number) ?? nodeHeight;
    const cx = pos?.x ?? 0;
    const cy = pos?.y ?? 0;
    // dagre centers nodes; React Flow positions by top-left corner.
    return {
      ...node,
      position: { x: cx - w / 2 + offsetX, y: cy - h / 2 + offsetY },
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
    };
  });
}

/** Bounding box of a set of laid-out nodes. */
export function boundingBox(nodes: Node[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const w = (n.width as number) ?? NODE_W;
    const h = (n.height as number) ?? NODE_H;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return { minX, minY, maxX, maxY };
}

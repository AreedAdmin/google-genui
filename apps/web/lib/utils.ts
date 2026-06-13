import { clsx, type ClassValue } from "clsx";
import type { PlanGraph, PlanNode, Branch, NodeAnnotation, Granularity } from "@trellis/shared";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** Parse a `file#symbol` grounded ref into its parts. */
export function parseRef(ref: string): { file: string; symbol?: string } {
  const hashIdx = ref.indexOf("#");
  if (hashIdx === -1) return { file: ref };
  return { file: ref.slice(0, hashIdx), symbol: ref.slice(hashIdx + 1) };
}

export function shortRef(ref: string): string {
  const { file, symbol } = parseRef(ref);
  const base = file.split("/").pop() ?? file;
  return symbol ? `${base}#${symbol}` : base;
}

/** Index a plan graph for O(1) node / branch / annotation lookups. */
export interface PlanIndex {
  nodeById: Map<string, PlanNode>;
  branchById: Map<string, Branch>;
  branchIndex: Map<string, number>;
  annotationByNode: Map<string, NodeAnnotation>;
}

export function indexPlan(graph: PlanGraph): PlanIndex {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const branchById = new Map(graph.branches.map((b) => [b.id, b]));
  const branchIndex = new Map(graph.branches.map((b, i) => [b.id, i]));
  const annotationByNode = new Map(graph.annotations.map((a) => [a.node_id, a]));
  return { nodeById, branchById, branchIndex, annotationByNode };
}

/**
 * Compute, for a set of selected nodes, whether they are mutually
 * parallel-safe and surface conflicting refs. Independence is derived from the
 * branches' `independent_of` (proven) and the resolved touch-sets (shared files
 * → false independence). Honesty: we only flag with concrete evidence.
 */
export interface IndependenceResult {
  parallelSafe: boolean;
  branchCount: number;
  conflicts: { a: string; b: string; shared: string[] }[];
}

function resolvedFiles(node: PlanNode): string[] {
  const r = node.touch_set.resolved;
  if (r?.files?.length) return r.files;
  // fall back to predicted symbol files
  const preds = [
    ...node.touch_set.predicted.add,
    ...node.touch_set.predicted.modify,
    ...node.touch_set.predicted.delete,
  ];
  return preds.map((p) => p.file).filter((f): f is string => Boolean(f));
}

export function analyzeIndependence(graph: PlanGraph, nodeIds: string[]): IndependenceResult {
  const idx = indexPlan(graph);
  const nodes = nodeIds.map((id) => idx.nodeById.get(id)).filter((n): n is PlanNode => Boolean(n));
  const branchIds = new Set(nodes.map((n) => n.branch_id).filter((b): b is string => Boolean(b)));

  const conflicts: { a: string; b: string; shared: string[] }[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (!a || !b) continue;
      if (a.branch_id && b.branch_id && a.branch_id === b.branch_id) continue;
      const filesA = new Set(resolvedFiles(a));
      const shared = resolvedFiles(b).filter((f) => filesA.has(f));
      if (shared.length > 0) {
        conflicts.push({ a: a.id, b: b.id, shared: Array.from(new Set(shared)) });
      }
    }
  }

  return {
    parallelSafe: conflicts.length === 0 && branchIds.size > 1,
    branchCount: branchIds.size,
    conflicts,
  };
}

/** Detect false-independence for a single node vs the rest of the plan. */
export function falseIndependenceRefs(graph: PlanGraph, nodeId: string): string[] {
  const idx = indexPlan(graph);
  const node = idx.nodeById.get(nodeId);
  if (!node || !node.branch_id) return [];
  const branch = idx.branchById.get(node.branch_id);
  if (!branch) return [];
  // Only branches the engine *claims* are independent can be falsely independent.
  if (branch.independent_of.length === 0) return [];

  const myFiles = new Set(resolvedFiles(node));
  const refs: string[] = [];
  for (const other of graph.nodes) {
    if (other.id === nodeId) continue;
    if (!other.branch_id || other.branch_id === node.branch_id) continue;
    if (!branch.independent_of.includes(other.branch_id)) continue;
    for (const f of resolvedFiles(other)) {
      if (myFiles.has(f)) refs.push(f);
    }
  }
  return Array.from(new Set(refs));
}

export const GRANULARITY_LABEL: Record<Granularity, { short: string; full: string }> = {
  g1_micro: { short: "G1", full: "Micro" },
  g2_meso: { short: "G2", full: "Meso" },
  g3_macro: { short: "G3", full: "Macro" },
  g4_mega: { short: "G4", full: "Mega" },
};

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

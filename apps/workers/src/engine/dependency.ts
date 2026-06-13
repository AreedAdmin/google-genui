import { randomUUID } from "node:crypto";
import type {
  TouchSet,
  EdgeType,
  EdgeEvidence,
} from "@trellis/shared";
import {
  analysisService,
  type ResolvedTouchSet,
  type PredictedTouchSet,
} from "../analysis.js";
import type { PlannerNode, EmitPlan } from "../agents/planner.js";
import { logger } from "../log.js";

const log = logger("engine");

/**
 * Dependency-Inference Engine (dependency-inference-engine.md). Deterministic:
 *
 *  Stage 3  resolve each node's predicted touch-set -> resolved + blast radius
 *           (analysis /resolve-touchset; TS fallback = predicted files/symbols).
 *  Stage 4  derive edges: provider/consumer symbol relations + touch-set overlap
 *           (analysis /overlap; TS fallback = set intersection of predicted files).
 *  Stage 5  classify independence (overlap_score, no shared mutated file/symbol).
 *  Stage 6  partition branches = weakly-connected components of the HARD-edge
 *           subgraph; disjoint touch-sets => independent, record independent_of[].
 *
 * Asymmetric caution: when unsure, prefer a dependency (a false dependency only
 * costs parallelism; a false independence costs a corrupted merge).
 */

export interface ResolvedNode {
  /** Persisted node id (assigned by the caller before edge derivation). */
  id: string;
  title: string;
  planner: PlannerNode;
  touchSet: TouchSet;
  resolutionConfidence: number;
  /** Symbols this node *provides* (creates) — for provider/consumer edges. */
  provides: Set<string>;
  /** Files/symbols this node *touches* — for overlap. */
  files: Set<string>;
  symbols: Set<string>;
  /** Blast-radius callers/consumers this node *consumes*. */
  consumes: Set<string>;
}

export interface DerivedEdge {
  id: string;
  from_node: string;
  to_node: string;
  type: EdgeType;
  rationale: string;
  evidence: EdgeEvidence;
  overlap_score: number;
}

export interface DerivedBranch {
  id: string;
  label: string;
  node_ids: string[];
  independent_of: string[]; // branch ids
}

export interface EngineResult {
  edges: DerivedEdge[];
  branches: DerivedBranch[];
}

// ---- Stage 3: resolve a node's predicted touch-set ----

function predictedFromPlanner(node: PlannerNode): PredictedTouchSet {
  const map = (xs: PlannerNode["touch_set"]["predicted"]["add"]) =>
    xs.map((s) => ({ kind: s.kind, name: s.name, file: s.file ?? null, change_signature: s.change_signature ?? false }));
  return {
    add: map(node.touch_set.predicted.add),
    modify: map(node.touch_set.predicted.modify),
    delete: map(node.touch_set.predicted.delete),
  };
}

/** TS-side fallback resolution: treat predicted files/symbols as the resolved set. */
function fallbackResolve(node: PlannerNode): { resolved: ResolvedTouchSet; confidence: number } {
  const files = new Set<string>();
  const symbols = new Set<string>();
  const sigs = new Set<string>();
  for (const group of [node.touch_set.predicted.add, node.touch_set.predicted.modify, node.touch_set.predicted.delete]) {
    for (const s of group) {
      if (s.file) files.add(s.file);
      const ref = s.file ? `${s.file}#${s.name}` : s.name;
      symbols.add(ref);
      if (s.change_signature) sigs.add(ref);
    }
  }
  return {
    resolved: {
      files: [...files],
      symbols: [...symbols],
      signatures_changed: [...sigs],
      schema_keys: [],
      config_keys: [],
    },
    confidence: 0.4, // low — unresolved against a real graph
  };
}

export async function resolveNode(
  projectId: string,
  commit: string,
  id: string,
  node: PlannerNode,
): Promise<ResolvedNode> {
  const predicted = predictedFromPlanner(node);
  const remote = await analysisService.resolveTouchset(projectId, commit, predicted);

  let resolved: ResolvedTouchSet;
  let confidence: number;
  const consumes = new Set<string>();

  if (remote) {
    resolved = remote.resolved;
    confidence = remote.confidence;
    for (const c of remote.blast_radius.callers) consumes.add(c);
    for (const c of remote.blast_radius.signature_call_sites) consumes.add(c);
    for (const c of remote.blast_radius.type_refs) consumes.add(c);
    for (const f of remote.blast_radius.files) resolved.files.includes(f) || resolved.files.push(f);
  } else {
    const fb = fallbackResolve(node);
    resolved = fb.resolved;
    confidence = fb.confidence;
  }

  // Provider symbols = things this node ADDS (other nodes may consume them).
  const provides = new Set<string>();
  for (const s of node.touch_set.predicted.add) {
    provides.add(s.file ? `${s.file}#${s.name}` : s.name);
    provides.add(s.name);
  }

  const touchSet: TouchSet = {
    predicted: {
      add: node.touch_set.predicted.add.map((s) => ({ kind: s.kind, name: s.name, file: s.file })),
      modify: node.touch_set.predicted.modify.map((s) => ({ kind: s.kind, name: s.name, file: s.file })),
      delete: node.touch_set.predicted.delete.map((s) => ({ kind: s.kind, name: s.name, file: s.file })),
    },
    resolved,
    resolution_confidence: confidence,
  };

  return {
    id,
    title: node.title,
    planner: node,
    touchSet,
    resolutionConfidence: confidence,
    provides,
    files: new Set(resolved.files),
    symbols: new Set(resolved.symbols),
    consumes,
  };
}

// ---- Stage 4/5: derive edges over resolved touch-sets ----

function intersect<T>(a: Set<T>, b: Set<T>): T[] {
  const out: T[] = [];
  for (const x of a) if (b.has(x)) out.push(x);
  return out;
}

/**
 * Derive edges for an ordered pair. Returns at most one edge A->B (B depends on A).
 * Uses the analysis /overlap result when available, else a TS set-intersection.
 */
async function deriveEdge(
  projectId: string,
  commit: string,
  a: ResolvedNode,
  b: ResolvedNode,
): Promise<DerivedEdge | null> {
  // 1) Provider/consumer: B consumes/calls a symbol A creates -> hard symbol_dependency.
  const provided = intersect(a.provides, new Set([...b.symbols, ...b.consumes]));
  if (provided.length) {
    return edge(a, b, "depends_on", "symbol_dependency", {
      shared: provided,
      from_provides: provided,
      to_consumes: provided,
      overlap_score: 1,
    }, `${b.title} consumes symbol(s) ${a.title} creates: ${provided.slice(0, 3).join(", ")}`, 1);
  }

  // 2) Signature change in A that B's resolved set references -> hard signature_change.
  const sigOverlap = intersect(new Set(a.touchSet.resolved?.signatures_changed ?? []), b.consumes);
  if (sigOverlap.length) {
    return edge(a, b, "data_flow", "signature_change", {
      shared: sigOverlap,
      from_provides: sigOverlap,
      to_consumes: sigOverlap,
      overlap_score: 0.9,
    }, `${b.title} calls a signature ${a.title} changes`, 0.9);
  }

  // 3) Overlap score via the analysis service (preferred) for same-file/schema/config.
  const remote =
    a.touchSet.resolved && b.touchSet.resolved
      ? await analysisService.overlap(projectId, commit, a.touchSet.resolved, b.touchSet.resolved)
      : null;

  if (remote) {
    if (remote.shared.symbols.length || remote.shared.files.length) {
      // Same mutated file/symbol with no clear provider/consumer -> soft file_overlap (conflict risk).
      return edge(a, b, "soft_order", "file_overlap", {
        shared: [...remote.shared.files, ...remote.shared.symbols],
        from_provides: [],
        to_consumes: [],
        overlap_score: remote.overlap_score,
      }, `${a.title} and ${b.title} touch the same file/symbol`, remote.overlap_score);
    }
    if (remote.shared.schema.length) {
      return edge(a, b, "sequence", "schema_dependency", {
        shared: remote.shared.schema,
        from_provides: remote.shared.schema,
        to_consumes: remote.shared.schema,
        overlap_score: remote.overlap_score,
      }, `${b.title} depends on schema ${a.title} changes`, remote.overlap_score);
    }
    if (remote.shared.config.length) {
      return edge(a, b, "soft_order", "data_flow", {
        shared: remote.shared.config,
        from_provides: remote.shared.config,
        to_consumes: remote.shared.config,
        overlap_score: remote.overlap_score,
      }, `${a.title} and ${b.title} share config key(s)`, remote.overlap_score);
    }
    return null;
  }

  // 4) TS fallback overlap: intersect predicted files / symbols.
  const fileOverlap = intersect(a.files, b.files);
  const symOverlap = intersect(a.symbols, b.symbols);
  if (fileOverlap.length || symOverlap.length) {
    const shared = [...fileOverlap, ...symOverlap];
    const score = jaccard(a.files, b.files);
    return edge(a, b, "soft_order", "file_overlap", {
      shared,
      from_provides: [],
      to_consumes: [],
      overlap_score: score,
    }, `${a.title} and ${b.title} touch overlapping files (heuristic)`, score);
  }

  return null;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = intersect(a, b).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

function edge(
  a: ResolvedNode,
  b: ResolvedNode,
  type: EdgeType,
  reason: EdgeEvidence["reason"],
  evidence: Omit<EdgeEvidence, "reason">,
  rationale: string,
  overlap: number,
): DerivedEdge {
  return {
    id: randomUUID(),
    from_node: a.id,
    to_node: b.id,
    type,
    rationale,
    evidence: { reason, ...evidence },
    overlap_score: overlap,
  };
}

const HARD: ReadonlySet<EdgeType> = new Set<EdgeType>(["depends_on", "data_flow", "sequence"]);

// ---- Stage 6: branch partition (weakly-connected components of hard edges) ----

function partitionBranches(nodes: ResolvedNode[], edges: DerivedEdge[]): DerivedBranch[] {
  const idIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const parent = nodes.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const union = (x: number, y: number) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };

  // Union nodes connected by HARD edges only.
  for (const e of edges) {
    if (!HARD.has(e.type)) continue;
    const fi = idIndex.get(e.from_node);
    const ti = idIndex.get(e.to_node);
    if (fi !== undefined && ti !== undefined) union(fi, ti);
  }

  const groups = new Map<number, string[]>();
  nodes.forEach((n, i) => {
    const root = find(i);
    const arr = groups.get(root) ?? [];
    arr.push(n.id);
    groups.set(root, arr);
  });

  const byNode = new Map<string, ResolvedNode>(nodes.map((n) => [n.id, n]));
  const branches: DerivedBranch[] = [];
  let idx = 0;
  for (const node_ids of groups.values()) {
    const label =
      node_ids.length === 1 ? byNode.get(node_ids[0]!)!.title : `Branch ${idx + 1} (${node_ids.length} nodes)`;
    branches.push({ id: randomUUID(), label, node_ids, independent_of: [] });
    idx++;
  }

  // Record independent_of: a pair of branches is independent when NO node in one
  // shares a touched file/symbol with any node in the other (overlap_score ~ 0).
  for (let i = 0; i < branches.length; i++) {
    for (let j = 0; j < branches.length; j++) {
      if (i === j) continue;
      if (branchesDisjoint(branches[i]!, branches[j]!, byNode)) {
        branches[i]!.independent_of.push(branches[j]!.id);
      }
    }
  }

  return branches;
}

function branchesDisjoint(a: DerivedBranch, b: DerivedBranch, byNode: Map<string, ResolvedNode>): boolean {
  const aFiles = new Set<string>();
  const aSyms = new Set<string>();
  for (const id of a.node_ids) {
    const n = byNode.get(id)!;
    n.files.forEach((f) => aFiles.add(f));
    n.symbols.forEach((s) => aSyms.add(s));
  }
  for (const id of b.node_ids) {
    const n = byNode.get(id)!;
    for (const f of n.files) if (aFiles.has(f)) return false;
    for (const s of n.symbols) if (aSyms.has(s)) return false;
  }
  return true;
}

// ---- top-level derive ----

export async function deriveDependencies(
  projectId: string,
  commit: string,
  nodes: ResolvedNode[],
): Promise<EngineResult> {
  const edges: DerivedEdge[] = [];
  // Derive over unordered pairs; deriveEdge yields A->B (B depends on A).
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      // Avoid duplicating soft symmetric overlap edges: for soft overlap only
      // consider i<j; provider/consumer (asymmetric) considers both directions.
      const a = nodes[i]!;
      const b = nodes[j]!;
      const e = await deriveEdge(projectId, commit, a, b);
      if (!e) continue;
      if (!HARD.has(e.type) && i > j) continue; // de-dup symmetric soft edges
      // Don't add a soft edge if a hard edge already connects the pair.
      const existsHard = edges.some(
        (x) =>
          HARD.has(x.type) &&
          ((x.from_node === a.id && x.to_node === b.id) || (x.from_node === b.id && x.to_node === a.id)),
      );
      if (!HARD.has(e.type) && existsHard) continue;
      edges.push(e);
    }
  }

  // Apply planner soft_order hints as soft edges (engine may already have them).
  // (Resolved by caller mapping titles->ids; see plan-build worker.)

  const branches = partitionBranches(nodes, edges);
  log.info(`derived ${edges.length} edges, ${branches.length} branches`);
  return { edges, branches };
}

/** Map planner coarse_order title pairs to soft_order edges, given a title->id map. */
export function coarseOrderEdges(plan: EmitPlan, titleToId: Map<string, string>): DerivedEdge[] {
  const out: DerivedEdge[] = [];
  for (const co of plan.coarse_order) {
    const from = titleToId.get(co.from);
    const to = titleToId.get(co.to);
    if (!from || !to || from === to) continue;
    out.push({
      id: randomUUID(),
      from_node: from,
      to_node: to,
      type: "soft_order",
      rationale: `planner soft order: ${co.from} before ${co.to}`,
      evidence: { reason: "sequence", shared: [], from_provides: [], to_consumes: [], overlap_score: 0 },
      overlap_score: 0,
    });
  }
  return out;
}

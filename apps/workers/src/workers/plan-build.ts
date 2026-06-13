import { randomUUID } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { QUEUES, type TouchSet, type ChangeType, type Granularity } from "@trellis/shared";
import { connectionOptions, getQueue } from "../queue.js";
import { db, recordEvent } from "../supabase.js";
import { ensureRepo } from "../worktree.js";
import { analysisService } from "../analysis.js";
import { runPlanner } from "../agents/planner.js";
import { resolveNode, deriveDependencies, coarseOrderEdges, type ResolvedNode } from "../engine/dependency.js";
import { buildRepoSummary } from "../repo-summary.js";
import { logger } from "../log.js";

const log = logger("plan-build");

/**
 * plan-build worker (QUEUES.planBuild). Synchronous top half of the pipeline:
 *   load plan+project -> ensure repo -> index (best-effort) -> Planner (Opus)
 *   -> persist nodes -> engine resolve/derive/partition -> persist edges+branches
 *   -> plan.status='ready' + layout_spec -> events row -> enqueue analysis per node.
 *
 * Every external dependency degrades; the worker never throws to the point of
 * crashing the process (BullMQ would retry, but we also try to mark plan failed).
 */

interface PlanBuildData {
  plan_id: string;
}

/** Shape of a plan_nodes insert row we build before persisting. */
interface NodeInsert {
  id: string;
  plan_id: string;
  revision: number;
  title: string;
  change_type: ChangeType;
  granularity: Granularity;
  status: "pending";
  summary: string;
  touch_set: TouchSet;
  position: { x: number; y: number };
  confidence: number;
  branch_id: string | null;
}

export function startPlanBuildWorker(): Worker {
  const worker = new Worker<PlanBuildData>(
    QUEUES.planBuild,
    async (job) => handlePlanBuild(job),
    { connection: connectionOptions, concurrency: 2 },
  );
  worker.on("failed", (job, err) => log.error(`job ${job?.id} failed: ${err.message}`));
  log.info("plan-build worker started");
  return worker;
}

async function handlePlanBuild(job: Job<PlanBuildData>): Promise<void> {
  const { plan_id } = job.data;
  log.info(`building plan ${plan_id}`);
  const supabase = db();

  // 1a. Load plan + project.
  const { data: plan, error: planErr } = await supabase.from("plans").select("*").eq("id", plan_id).single();
  if (planErr || !plan) {
    log.error(`plan ${plan_id} not found: ${planErr?.message}`);
    return; // nothing to do
  }
  const { data: project } = await supabase.from("projects").select("*").eq("id", plan.project_id).single();

  await supabase.from("plans").update({ status: "planning" }).eq("id", plan_id);

  // Create a plan-level run row for accounting.
  const runId = randomUUID();
  await supabase.from("runs").insert({
    id: runId,
    plan_id,
    kind: "plan",
    status: "running",
    agent: "planner",
    started_at: new Date().toISOString(),
  });

  try {
    // 1a. Ensure repo (clone or sample fallback).
    const repo = await ensureRepo(
      plan.project_id,
      project?.repo_url ?? null,
      project?.default_branch ?? "main",
      plan.base_commit || null,
    );
    const baseCommit = plan.base_commit || repo.baseCommit;
    if (baseCommit && baseCommit !== plan.base_commit) {
      await supabase.from("plans").update({ base_commit: baseCommit }).eq("id", plan_id);
    }

    // 1b. Index the repo (best-effort).
    const indexed = await analysisService.index(plan.project_id, repo.path, baseCommit);
    if (indexed) log.info(`indexed repo: ${JSON.stringify(indexed.stats)}`);

    // Build a repo summary block for the planner (conventions + modules).
    const repoSummary = await buildRepoSummary(repo.path, repo.isSample);

    // 1c. Planner (Opus, tool-forced).
    const { plan: emitted, tokens: plannerTokens } = await runPlanner({
      prompt: plan.prompt,
      repoSummary,
      baseCommit,
    });
    log.info(`planner emitted ${emitted.nodes.length} nodes @ ${emitted.detected_granularity}`);

    // Assign ids first so the engine can reference them; resolve touch-sets.
    const revision: number = plan.current_revision ?? 1;
    const ids = emitted.nodes.map(() => randomUUID());
    const titleToId = new Map<string, string>();
    emitted.nodes.forEach((n, i) => titleToId.set(n.title, ids[i]!));

    // 1d. Dependency engine: resolve each node, derive edges, partition branches.
    const resolved: ResolvedNode[] = [];
    for (let i = 0; i < emitted.nodes.length; i++) {
      resolved.push(await resolveNode(plan.project_id, baseCommit, ids[i]!, emitted.nodes[i]!));
    }

    const { edges, branches } = await deriveDependencies(plan.project_id, baseCommit, resolved);
    const softEdges = coarseOrderEdges(emitted, titleToId);

    // Map each node to its branch.
    const nodeToBranch = new Map<string, string>();
    for (const b of branches) for (const nid of b.node_ids) nodeToBranch.set(nid, b.id);

    // 1e. Persist node rows (resolved touch_set + confidence folded in).
    const nodeRows: NodeInsert[] = emitted.nodes.map((n, i) => ({
      id: ids[i]!,
      plan_id,
      revision,
      title: n.title,
      change_type: n.change_type,
      granularity: n.granularity,
      status: "pending",
      summary: n.summary,
      touch_set: resolved[i]!.touchSet,
      position: { x: 0, y: 0 },
      confidence: resolved[i]!.resolutionConfidence,
      branch_id: nodeToBranch.get(ids[i]!) ?? null,
    }));

    // Persist branches first (FK target for plan_nodes.branch_id).
    const branchRows = branches.map((b) => ({
      id: b.id,
      plan_id,
      label: b.label,
      node_ids: b.node_ids,
      status: "idle" as const,
      independent_of: b.independent_of,
    }));
    if (branchRows.length) {
      const { error } = await supabase.from("branches").insert(branchRows);
      if (error) log.warn(`branch insert: ${error.message}`);
    }

    const { error: nodeErr } = await supabase.from("plan_nodes").insert(nodeRows);
    if (nodeErr) throw new Error(`node insert failed: ${nodeErr.message}`);

    const edgeRows = [...edges, ...softEdges].map((e) => ({
      id: e.id,
      plan_id,
      revision,
      from_node: e.from_node,
      to_node: e.to_node,
      type: e.type,
      rationale: e.rationale,
      evidence: e.evidence,
      overlap_score: e.overlap_score,
    }));
    if (edgeRows.length) {
      const { error } = await supabase.from("plan_edges").insert(edgeRows);
      if (error) log.warn(`edge insert: ${error.message}`);
    }

    // 1e. Plan ready + layout_spec.
    await supabase
      .from("plans")
      .update({ status: "ready", layout_spec: emitted.layout_spec, updated_at: new Date().toISOString() })
      .eq("id", plan_id);

    await supabase
      .from("runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), tokens: plannerTokens })
      .eq("id", runId);

    await recordEvent(plan_id, "plan.ready", {
      nodes: nodeRows.length,
      edges: edgeRows.length,
      branches: branchRows.length,
      granularity: emitted.detected_granularity,
      tier_reason: emitted.tier_reason,
      degraded_repo: repo.isSample,
    });

    // Enqueue one analysis job per node.
    const analysisQueue = getQueue(QUEUES.analysis);
    for (const row of nodeRows) {
      await analysisQueue.add("analyze", { node_id: row.id }, { jobId: `analysis:${row.id}:${revision}` });
    }
    log.info(`plan ${plan_id} ready; enqueued ${nodeRows.length} analysis jobs`);
  } catch (err) {
    log.error(`plan-build failed for ${plan_id}: ${(err as Error).message}`);
    await supabase.from("plans").update({ status: "failed" }).eq("id", plan_id);
    await supabase
      .from("runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: (err as Error).message })
      .eq("id", runId);
    await recordEvent(plan_id, "plan.failed", { error: (err as Error).message });
    // Do not rethrow: marking failed + event is the durable outcome; let the job
    // complete so BullMQ doesn't endlessly retry an LLM/schema failure.
  }
}

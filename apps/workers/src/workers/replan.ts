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
import { GuiStream } from "../gui-stream.js";
import { logger } from "../log.js";

const log = logger("replan");

/**
 * replan worker (QUEUES.replan / Flow C). Re-derives a plan with an added
 * context/correction at a NEW revision:
 *   load plan+project -> status=planning -> ensure/index repo -> Planner(Opus)
 *   with (original prompt + added context + current nodes) -> persist nodes/edges/
 *   branches at target_revision -> plan_revisions row -> bump current_revision +
 *   status=ready -> AG-UI snapshot -> enqueue analysis per node.
 *
 * Non-destructive: prior revisions' nodes/edges (and their runs/diffs) stay as
 * history; getPlanGraph reads current_revision, so the canvas re-flows to the new
 * graph. Branches aren't revision-scoped in the schema, so getPlanGraph filters
 * them to the current revision's nodes (no stale-branch leak).
 */

interface ReplanData {
  plan_id: string;
  context: string;
  target_revision: number;
}

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

export function startReplanWorker(): Worker {
  const worker = new Worker<ReplanData>(QUEUES.replan, async (job) => handleReplan(job), {
    connection: connectionOptions,
    concurrency: 2,
  });
  worker.on("failed", (job, err) => log.error(`job ${job?.id} failed: ${err.message}`));
  log.info("replan worker started");
  return worker;
}

async function handleReplan(job: Job<ReplanData>): Promise<void> {
  const { plan_id, context, target_revision } = job.data;
  log.info(`replanning ${plan_id} -> revision ${target_revision}`);
  const supabase = db();

  const { data: plan, error: planErr } = await supabase.from("plans").select("*").eq("id", plan_id).single();
  if (planErr || !plan) {
    log.error(`plan ${plan_id} not found: ${planErr?.message}`);
    return;
  }
  const { data: project } = await supabase.from("projects").select("*").eq("id", plan.project_id).single();

  // Flip to planning so the canvas polls and re-flows when the new revision lands.
  await supabase.from("plans").update({ status: "planning" }).eq("id", plan_id);

  // The current plan's node titles — given to the planner so it revises rather
  // than re-derives blind.
  const currentRevision: number = plan.current_revision ?? 1;
  const { data: existingNodes } = await supabase
    .from("plan_nodes")
    .select("title")
    .eq("plan_id", plan_id)
    .eq("revision", currentRevision);
  const currentTitles = (existingNodes ?? []).map((n) => `- ${n.title}`).join("\n");

  const runId = randomUUID();
  await supabase.from("runs").insert({
    id: runId,
    plan_id,
    kind: "replan",
    status: "running",
    agent: "replan",
    started_at: new Date().toISOString(),
  });

  const gui = new GuiStream(plan_id);
  await gui.runStarted(runId);

  try {
    const repo = await ensureRepo(
      plan.project_id,
      project?.repo_url ?? null,
      project?.default_branch ?? "main",
      plan.base_commit || null,
    );
    const baseCommit = plan.base_commit || repo.baseCommit;

    const indexed = await analysisService.index(plan.project_id, repo.path, baseCommit);
    if (indexed) log.info(`indexed repo: ${JSON.stringify(indexed.stats)}`);
    const repoSummary = await buildRepoSummary(repo.path, repo.isSample);

    const replanPrompt = `${plan.prompt}

# Revision context — a correction / added requirement. INCORPORATE it.
${context}

# Current plan nodes (revise: keep what still applies; add / modify / drop to satisfy the context above)
${currentTitles || "(none)"}`;

    const { plan: emitted, tokens: plannerTokens } = await runPlanner({
      prompt: replanPrompt,
      repoSummary,
      baseCommit,
    });
    log.info(`replan emitted ${emitted.nodes.length} nodes @ ${emitted.detected_granularity}`);

    // Fresh ids at the new revision.
    const ids = emitted.nodes.map(() => randomUUID());
    const titleToId = new Map<string, string>();
    emitted.nodes.forEach((n, i) => titleToId.set(n.title, ids[i]!));

    const resolved: ResolvedNode[] = [];
    for (let i = 0; i < emitted.nodes.length; i++) {
      resolved.push(await resolveNode(plan.project_id, baseCommit, ids[i]!, emitted.nodes[i]!));
    }
    const { edges, branches } = await deriveDependencies(plan.project_id, baseCommit, resolved);
    const softEdges = coarseOrderEdges(emitted, titleToId);

    const nodeToBranch = new Map<string, string>();
    for (const b of branches) for (const nid of b.node_ids) nodeToBranch.set(nid, b.id);

    const nodeRows: NodeInsert[] = emitted.nodes.map((n, i) => ({
      id: ids[i]!,
      plan_id,
      revision: target_revision,
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
      revision: target_revision,
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

    // Record the revision, then flip current_revision so getPlanGraph returns the
    // new graph atomically (nodes already persisted above).
    await supabase
      .from("plan_revisions")
      .insert({ plan_id, revision: target_revision, reason: context.slice(0, 2000) });

    await supabase
      .from("plans")
      .update({
        status: "ready",
        current_revision: target_revision,
        layout_spec: emitted.layout_spec,
        updated_at: new Date().toISOString(),
      })
      .eq("id", plan_id);

    await supabase
      .from("runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), tokens: plannerTokens })
      .eq("id", runId);

    await recordEvent(plan_id, "plan.replanned", {
      revision: target_revision,
      nodes: nodeRows.length,
      edges: edgeRows.length,
      branches: branchRows.length,
      granularity: emitted.detected_granularity,
    });

    await gui.stateSnapshot({
      plan: { ...plan, status: "ready", current_revision: target_revision, layout_spec: emitted.layout_spec },
      nodes: nodeRows,
      edges: edgeRows,
      branches: branchRows,
      annotations: [],
    });
    await gui.runFinished(runId);

    const analysisQueue = getQueue(QUEUES.analysis);
    for (const row of nodeRows) {
      await analysisQueue.add("analyze", { node_id: row.id }, { jobId: `analysis-${row.id}-${target_revision}` });
    }
    log.info(`plan ${plan_id} replanned to revision ${target_revision}; enqueued ${nodeRows.length} analysis jobs`);
  } catch (err) {
    log.error(`replan failed for ${plan_id}: ${(err as Error).message}`);
    // Revert to ready on the existing revision — the prior graph stays valid.
    await supabase.from("plans").update({ status: "ready" }).eq("id", plan_id);
    await supabase
      .from("runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: (err as Error).message })
      .eq("id", runId);
    await recordEvent(plan_id, "plan.replan_failed", { error: (err as Error).message });
    await gui.runError((err as Error).message);
  } finally {
    await gui.close();
  }
}

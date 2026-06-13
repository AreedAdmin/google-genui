import { randomUUID } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { QUEUES, WorkOrder, keys, type TouchSet } from "@trellis/shared";
import { connectionOptions } from "../queue.js";
import { db, recordEvent } from "../supabase.js";
import { env } from "../env.js";
import { ensureRepo, createWorktree, diffWorktree, changedFiles, detectTestCommand } from "../worktree.js";
import { getRunner } from "../runners/index.js";
import { RunStream } from "../stream.js";
import { GuiStream } from "../gui-stream.js";
import { logger } from "../log.js";

const log = logger("node-run");

/**
 * node-run worker (QUEUES.nodeRun). Concurrency = MAX_CONCURRENT_BRANCHES.
 *
 * Per {node_id}:
 *   - idempotency guard on runs.id (already-built node => no-op)
 *   - create ephemeral worktree off base_commit (worktree-per-node here)
 *   - build a WorkOrder from the node + its annotation (touch_set/assumptions/risks)
 *   - run the runner selected by EXECUTION_BACKEND, relaying RunnerEvents to
 *     stream:run:{run_id}
 *   - harvest `git diff`, audit drift (files outside touch_set) -> events
 *   - update runs + plan_nodes.status
 */

interface NodeRunData {
  node_id: string;
  /** Pre-created run id from the API's dispatchNode (so web + worker share it). */
  run_id?: string;
  plan_id?: string;
  /** Optional override; else project/plan execution_backend, else env default. */
  execution_backend?: string;
}

export function startNodeRunWorker(): Worker {
  const worker = new Worker<NodeRunData>(
    QUEUES.nodeRun,
    async (job) => handleNodeRun(job),
    { connection: connectionOptions, concurrency: Math.max(1, env.maxConcurrentBranches) },
  );
  worker.on("failed", (job, err) => log.error(`job ${job?.id} failed: ${err.message}`));
  log.info(`node-run worker started (concurrency=${env.maxConcurrentBranches})`);
  return worker;
}

async function handleNodeRun(job: Job<NodeRunData>): Promise<void> {
  const { node_id } = job.data;
  const supabase = db();

  const { data: node, error } = await supabase.from("plan_nodes").select("*").eq("id", node_id).single();
  if (error || !node) {
    log.warn(`node ${node_id} not found: ${error?.message}`);
    return;
  }

  // Idempotency: a node already built is a no-op (builder-agent.md §6).
  if (node.status === "built" || node.status === "merged") {
    log.info(`node ${node_id} already ${node.status}; skipping`);
    return;
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("project_id, base_commit, current_revision")
    .eq("id", node.plan_id)
    .single();
  const { data: project } = await supabase
    .from("projects")
    .select("repo_url, default_branch, execution_backend")
    .eq("id", plan?.project_id)
    .single();
  const { data: annotation } = await supabase
    .from("node_annotations")
    .select("assumptions, analysis")
    .eq("node_id", node_id)
    .maybeSingle();

  // Reuse the run row the API's dispatchNode pre-created (the SAME id the web
  // subscribes to) so the live console streams correctly; fall back to a fresh id
  // for callers that don't pre-create one. upsert => update the queued row,
  // never insert a duplicate.
  const runId = job.data.run_id ?? randomUUID();
  const streamKey = keys.runStream(runId);
  const backend = job.data.execution_backend ?? project?.execution_backend ?? env.executionBackend;

  await supabase.from("runs").upsert({
    id: runId,
    plan_id: node.plan_id,
    node_id,
    branch_id: node.branch_id ?? null,
    kind: "node_build",
    status: "running",
    agent: backend,
    model: env.claudeCodeModel,
    started_at: new Date().toISOString(),
    logs_stream_key: streamKey,
  });
  await supabase.from("plan_nodes").update({ status: "running" }).eq("id", node_id);

  const stream = new RunStream(runId);
  await stream.emit("status", { state: "queued", node_id });

  // AG-UI: structured lifecycle/status events for this node run drive the canvas.
  const gui = new GuiStream(node.plan_id);
  await gui.runStarted(runId);

  const touchSet = (node.touch_set ?? { predicted: { add: [], modify: [], delete: [] } }) as TouchSet;

  try {
    // Worktree off base_commit.
    const repo = await ensureRepo(
      plan?.project_id ?? "",
      project?.repo_url ?? null,
      project?.default_branch ?? "main",
      plan?.base_commit ?? null,
    );
    const baseCommit = plan?.base_commit || repo.baseCommit;
    const wt = await createWorktree(repo, `node-${node_id.slice(0, 8)}`, baseCommit);
    await supabase.from("plan_nodes").update({ worktree_ref: wt.ref }).eq("id", node_id);

    // Build the WorkOrder.
    const testCmd = await detectTestCommand(wt.path);
    const order = WorkOrder.parse({
      run_id: runId,
      node_id,
      plan_id: node.plan_id,
      revision: node.revision ?? plan?.current_revision ?? 1,
      base_commit: baseCommit,
      worktree_path: wt.path,
      goal: `${node.title}: ${node.summary}`,
      changes: [],
      touch_set: {
        allowed_files: touchSet.resolved?.files ?? [],
        allowed_symbols: touchSet.resolved?.symbols ?? [],
        signatures: touchSet.resolved?.signatures_changed ?? [],
      },
      assumptions: (annotation?.assumptions ?? []).map((a: { text: string }) => a.text).filter(Boolean),
      risks: (annotation?.analysis ?? []).map((r: { text: string }) => r.text).filter(Boolean),
      acceptance: { tests: [], commands: testCmd ? [testCmd] : [] },
      policy: {
        network: "deny-except-proxies",
        fs_scope: "worktree",
        max_turns: env.claudeCodeMaxTurns,
        wallclock_s: 900,
      },
    });

    // Run the selected runner.
    const runner = getRunner(backend);
    await stream.emit("status", { state: "running", runner: runner.id });
    const result = await runner.start(order, { onEvent: (e) => void stream.push(e) });

    // Harvest diff + drift audit (orchestration owns this).
    const diff = await diffWorktree(wt);
    const touched = await changedFiles(wt);
    const allowed = new Set(order.touch_set.allowed_files);
    const drift = touched.filter((f) => allowed.size > 0 && !allowed.has(f) && f !== "CLAUDE.md");

    if (drift.length) {
      await recordEvent(node.plan_id, "node.drift", {
        node_id,
        run_id: runId,
        predicted: false,
        paths: drift,
        kind: "file_outside_touchset",
      });
      await stream.emit("status", { state: "drift", paths: drift });
    }

    const succeeded = result.status === "succeeded";
    const finalNodeStatus = succeeded ? "built" : result.status === "cancelled" ? "blocked" : "failed";

    await supabase
      .from("runs")
      .update({
        status: result.status,
        finished_at: new Date().toISOString(),
        tokens: result.tokens,
        cost: result.cost,
        result: { ...result, drift, diff_present: diff.length > 0, diff: diff.slice(0, 200_000), files_touched: touched },
      })
      .eq("id", runId);

    await supabase
      .from("plan_nodes")
      .update({ status: finalNodeStatus })
      .eq("id", node_id);

    await recordEvent(node.plan_id, succeeded ? "node.built" : "node.failed", {
      node_id,
      run_id: runId,
      runner: runner.id,
      drift: drift.length,
      summary: result.summary,
    });

    await stream.emit("status", { state: finalNodeStatus, summary: result.summary });
    await gui.custom("node_status", { node_id, status: finalNodeStatus });
    await gui.runFinished(runId);
    log.info(`node ${node_id} -> ${finalNodeStatus} (${touched.length} files, ${drift.length} drift)`);

    // GC the worktree (object data preserved via the diff result already stored).
    await wt.remove();
  } catch (err) {
    log.error(`node-run failed for ${node_id}: ${(err as Error).message}`);
    await supabase
      .from("runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: (err as Error).message })
      .eq("id", runId);
    await supabase.from("plan_nodes").update({ status: "failed" }).eq("id", node_id);
    await recordEvent(node.plan_id, "node.failed", { node_id, error: (err as Error).message });
    await stream.emit("error", { message: (err as Error).message });
    await gui.runError((err as Error).message);
    await gui.custom("node_status", { node_id, status: "failed" });
  } finally {
    await stream.close();
    await gui.close();
  }
}

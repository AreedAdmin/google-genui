import { randomUUID } from "node:crypto";
import { Worker, type Job } from "bullmq";
import { QUEUES, keys } from "@trellis/shared";
import { connectionOptions, createRedis } from "../queue.js";
import { db, recordEvent } from "../supabase.js";
import { ensureRepo, createWorktree, detectTestCommand } from "../worktree.js";
import { RunStream } from "../stream.js";
import { logger } from "../log.js";
import { spawn } from "node:child_process";

const log = logger("integration");

/**
 * integration worker (QUEUES.integration). Merges a plan's built branches onto a
 * fresh integration worktree off base_commit (integration-merge.md §3):
 *   - sequential `git merge --no-ff` of each branch ref
 *   - on conflict -> write conflict_report + stop (no auto-merge on red)
 *   - on all clean -> run the project's test command (if any); red gate => conflicted
 *   - green => merged + merge_commit; set branch/plan statuses
 */

interface IntegrationData {
  plan_id: string;
  /** Optional explicit branch set; else all built branches on the plan. */
  branch_ids?: string[];
  integration_node_id?: string;
}

export function startIntegrationWorker(): Worker {
  const worker = new Worker<IntegrationData>(
    QUEUES.integration,
    async (job) => handleIntegration(job),
    { connection: connectionOptions, concurrency: 1 },
  );
  worker.on("failed", (job, err) => log.error(`job ${job?.id} failed: ${err.message}`));
  log.info("integration worker started");
  return worker;
}

async function handleIntegration(job: Job<IntegrationData>): Promise<void> {
  const { plan_id } = job.data;
  const supabase = db();

  // Serialize overlapping integrations with a plan lock (best-effort).
  const lock = createRedis();
  const lockKey = keys.lockPlan(plan_id);
  const lockToken = randomUUID();
  const got = await lock.set(lockKey, lockToken, "EX", 600, "NX");
  if (got !== "OK") {
    log.info(`plan ${plan_id} already integrating; requeue later`);
    lock.disconnect();
    return;
  }

  const { data: plan } = await supabase.from("plans").select("project_id, base_commit").eq("id", plan_id).single();
  const { data: project } = await supabase
    .from("projects")
    .select("repo_url, default_branch")
    .eq("id", plan?.project_id)
    .single();

  // Resolve target branches: built branches with worktree refs / node worktree refs.
  const branchQuery = supabase.from("branches").select("*").eq("plan_id", plan_id);
  const { data: branches } = job.data.branch_ids?.length
    ? await branchQuery.in("id", job.data.branch_ids)
    : await branchQuery.eq("status", "built");

  // Integration node row.
  const integId = job.data.integration_node_id ?? randomUUID();
  await supabase.from("integration_nodes").upsert({
    id: integId,
    plan_id,
    target_branches: (branches ?? []).map((b) => b.id),
    status: "merging",
  });

  const runId = randomUUID();
  const stream = new RunStream(runId);
  await supabase.from("runs").insert({
    id: runId,
    plan_id,
    kind: "integration",
    status: "running",
    agent: "integration",
    started_at: new Date().toISOString(),
    logs_stream_key: keys.runStream(runId),
  });

  try {
    await supabase.from("plans").update({ status: "executing" }).eq("id", plan_id);

    const repo = await ensureRepo(
      plan?.project_id ?? "",
      project?.repo_url ?? null,
      project?.default_branch ?? "main",
      plan?.base_commit ?? null,
    );
    const baseCommit = plan?.base_commit || repo.baseCommit;
    const wt = await createWorktree(repo, `integ-${plan_id.slice(0, 8)}`, baseCommit);
    await stream.emit("status", { state: "merging", base: baseCommit });

    // Collect branch refs to merge. We merge each branch's node worktree refs in
    // node order. In this MVP, each node committed to a `trellis/<id>` ref inside
    // the shared repo; we attempt to merge those refs sequentially.
    const branchRefs: { branchId: string; ref: string }[] = [];
    for (const b of branches ?? []) {
      const { data: nodes } = await supabase
        .from("plan_nodes")
        .select("worktree_ref, status")
        .eq("plan_id", plan_id)
        .in("id", b.node_ids ?? []);
      for (const n of nodes ?? []) {
        if (n.worktree_ref && n.status === "built") branchRefs.push({ branchId: b.id, ref: n.worktree_ref });
      }
    }

    const mergedClean: string[] = [];
    let conflict: { branchId: string; ref: string; output: string } | null = null;

    for (const { branchId, ref } of branchRefs) {
      const res = await gitMerge(wt.path, ref);
      if (res.ok) {
        mergedClean.push(ref);
        await stream.emit("status", { merged: ref });
      } else {
        conflict = { branchId, ref, output: res.output };
        await stream.emit("error", { conflict: ref, output: res.output.slice(0, 500) });
        // Stop accumulating; already-clean branches stay applied (partial progress).
        await abortMerge(wt.path);
        break;
      }
    }

    if (conflict) {
      const report = {
        kind: "textual" as const,
        base_commit: baseCommit,
        branches: branchRefs.map((b) => b.branchId),
        merged_clean: mergedClean,
        textual: [{ ref: conflict.ref, branch: conflict.branchId, output: conflict.output.slice(0, 2000) }],
      };
      await supabase
        .from("integration_nodes")
        .update({ status: "conflicted", conflict_report: report })
        .eq("id", integId);
      await supabase
        .from("branches")
        .update({ status: "conflicted" })
        .eq("id", conflict.branchId);
      await supabase.from("plans").update({ status: "partially_merged" }).eq("id", plan_id);
      await supabase
        .from("runs")
        .update({ status: "failed", finished_at: new Date().toISOString(), result: report, error: "merge conflict" })
        .eq("id", runId);
      await recordEvent(plan_id, "integration.conflicted", { integration_node_id: integId, branch: conflict.branchId });
      await stream.emit("status", { state: "conflicted" });
      log.warn(`plan ${plan_id} integration conflicted on ${conflict.ref}`);
      await wt.remove();
      return;
    }

    // All clean -> full test gate (if a command exists).
    const testCmd = await detectTestCommand(wt.path);
    let gateGreen = true;
    let gateOutput = "";
    if (testCmd) {
      await stream.emit("status", { state: "testing", cmd: testCmd });
      const gate = await runCommand(wt.path, testCmd);
      gateGreen = gate.code === 0;
      gateOutput = `${gate.stdout}\n${gate.stderr}`.slice(0, 4000);
    } else {
      log.info("no test command detected; skipping gate (treated as green for MVP)");
    }

    if (!gateGreen) {
      // Semantic conflict: clean textual merge but red gate. No auto-merge on red.
      const report = {
        kind: "semantic" as const,
        base_commit: baseCommit,
        branches: branchRefs.map((b) => b.branchId),
        merged_clean: mergedClean,
        semantic: [{ failing_tests: ["(see output)"], evidence: gateOutput }],
      };
      await supabase
        .from("integration_nodes")
        .update({ status: "conflicted", conflict_report: report })
        .eq("id", integId);
      await supabase.from("plans").update({ status: "partially_merged" }).eq("id", plan_id);
      await supabase
        .from("runs")
        .update({ status: "failed", finished_at: new Date().toISOString(), result: report, error: "test gate red" })
        .eq("id", runId);
      await recordEvent(plan_id, "integration.gate_red", { integration_node_id: integId });
      await stream.emit("status", { state: "conflicted", reason: "gate_red" });
      log.warn(`plan ${plan_id} integration gate red`);
      await wt.remove();
      return;
    }

    // Green: resolve the integration HEAD as the merge commit.
    const mergeCommit = await commitIntegration(wt.path);
    await supabase
      .from("integration_nodes")
      .update({ status: "merged", merge_commit: mergeCommit })
      .eq("id", integId);
    for (const b of branches ?? []) {
      await supabase.from("branches").update({ status: "merged" }).eq("id", b.id);
    }
    await supabase
      .from("plan_nodes")
      .update({ status: "merged" })
      .eq("plan_id", plan_id)
      .eq("status", "built");
    await supabase.from("plans").update({ status: "merged" }).eq("id", plan_id);
    await supabase
      .from("runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), result: { merge_commit: mergeCommit, mergedClean } })
      .eq("id", runId);
    await recordEvent(plan_id, "integration.merged", { integration_node_id: integId, merge_commit: mergeCommit });
    await stream.emit("status", { state: "merged", merge_commit: mergeCommit });
    log.info(`plan ${plan_id} merged (${mergeCommit})`);
    await wt.remove();
  } catch (err) {
    log.error(`integration failed for ${plan_id}: ${(err as Error).message}`);
    await supabase.from("integration_nodes").update({ status: "failed" }).eq("id", integId);
    await supabase
      .from("runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: (err as Error).message })
      .eq("id", runId);
    await recordEvent(plan_id, "integration.failed", { error: (err as Error).message });
  } finally {
    await stream.close();
    // Release the lock only if we still own it.
    try {
      const cur = await lock.get(lockKey);
      if (cur === lockToken) await lock.del(lockKey);
    } catch {
      /* ignore */
    }
    lock.disconnect();
  }
}

// ---- git helpers (child_process; merge can't use simple-git's clean abstraction well) ----

function runCommand(cwd: string, cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", cmd], { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 300000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr + err.message });
    });
  });
}

async function gitMerge(cwd: string, ref: string): Promise<{ ok: boolean; output: string }> {
  const res = await runCommand(cwd, `git merge --no-ff --no-edit ${ref}`);
  return { ok: res.code === 0, output: `${res.stdout}\n${res.stderr}` };
}

async function abortMerge(cwd: string): Promise<void> {
  await runCommand(cwd, "git merge --abort").catch(() => {});
}

async function commitIntegration(cwd: string): Promise<string> {
  // The merges already produced commits; just resolve HEAD.
  const res = await runCommand(cwd, "git rev-parse HEAD");
  return res.code === 0 ? res.stdout.trim() : "";
}

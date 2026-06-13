import { Worker, type Job } from "bullmq";
import { QUEUES, TouchSet } from "@trellis/shared";
import { connectionOptions } from "../queue.js";
import { db, recordEvent } from "../supabase.js";
import { runAnalysis } from "../agents/analysis.js";
import { logger } from "../log.js";

const log = logger("analysis-worker");

/**
 * analysis worker (QUEUES.analysis). Per {node_id}: load node + plan/project,
 * run the Analysis/Annotation agent (Opus) to produce the five sections +
 * WidgetSpec[], persist to node_annotations. Best-effort and re-runnable: a
 * failed annotation never blocks plan readiness or execution.
 */

interface AnalysisData {
  node_id: string;
}

export function startAnalysisWorker(): Worker {
  const worker = new Worker<AnalysisData>(
    QUEUES.analysis,
    async (job) => handleAnalysis(job),
    { connection: connectionOptions, concurrency: 4 },
  );
  worker.on("failed", (job, err) => log.error(`job ${job?.id} failed: ${err.message}`));
  log.info("analysis worker started");
  return worker;
}

async function handleAnalysis(job: Job<AnalysisData>): Promise<void> {
  const { node_id } = job.data;
  const supabase = db();

  const { data: node, error } = await supabase.from("plan_nodes").select("*").eq("id", node_id).single();
  if (error || !node) {
    log.warn(`node ${node_id} not found: ${error?.message}`);
    return;
  }
  const { data: plan } = await supabase.from("plans").select("project_id, base_commit, current_revision").eq("id", node.plan_id).single();

  // Parse the stored touch_set through the shared schema (defensive).
  const parsedTouch = TouchSet.safeParse(node.touch_set);
  const touchSet = parsedTouch.success
    ? parsedTouch.data
    : { predicted: { add: [], modify: [], delete: [] } };

  try {
    const { annotation, tokens } = await runAnalysis({
      projectId: plan?.project_id ?? "",
      commit: plan?.base_commit ?? "",
      nodeId: node_id,
      title: node.title,
      summary: node.summary,
      changeType: node.change_type,
      touchSet,
    });

    // Upsert node_annotations (1:1 with node).
    const { error: upErr } = await supabase.from("node_annotations").upsert(
      {
        node_id,
        revision: node.revision ?? plan?.current_revision ?? 1,
        assumptions: annotation.assumptions,
        analysis: annotation.analysis,
        benefits: annotation.benefits,
        notable_symbols: annotation.notable_symbols,
        widget_specs: annotation.widget_specs,
        model: process.env.ANALYSIS_MODEL ?? "claude-opus-4-8",
        tokens,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "node_id" },
    );
    if (upErr) throw new Error(`annotation upsert failed: ${upErr.message}`);

    await recordEvent(node.plan_id, "node.annotated", {
      node_id,
      assumptions: annotation.assumptions.length,
      risks: annotation.analysis.length,
      widgets: annotation.widget_specs.length,
    });
    log.info(`annotated node ${node_id}`);
  } catch (err) {
    log.error(`analysis failed for node ${node_id}: ${(err as Error).message}`);
    await recordEvent(node.plan_id, "node.analysis_failed", { node_id, error: (err as Error).message });
    // Best-effort: leave the node operable; do not rethrow.
  }
}

import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AgentRunner, WorkOrder, RunnerResult, RunnerIO } from "@trellis/shared";
import { logger } from "../log.js";

const log = logger("native-runner");

/**
 * NativeRunner — a tiny stub behind the AgentRunner interface (agent-runners.md §5).
 *
 * The full native runner is the Sonnet 4.6 tool-use loop in builder-agent.md; for
 * the MVP this stub is the graceful fallback when Claude Code is unavailable. It
 * writes a placeholder file inside the worktree (respecting touch_set when it can)
 * and reports it as a stub so the rest of the pipeline (diff harvest, drift audit,
 * test gate, status machine) still exercises end-to-end.
 */
export class NativeRunner implements AgentRunner {
  readonly id = "native";

  async start(order: WorkOrder, io: RunnerIO): Promise<RunnerResult> {
    io.onEvent({ type: "status", at: new Date().toISOString(), data: { runner: this.id, state: "starting" } });
    io.onEvent({
      type: "text",
      at: new Date().toISOString(),
      data: { text: `NativeRunner (stub) handling: ${order.goal}` },
    });

    // Pick a target inside the touch_set if available, else a notes file.
    const target = order.touch_set.allowed_files[0] ?? "TRELLIS_NATIVE_STUB.md";
    const absPath = join(order.worktree_path, target);
    const filesTouched: string[] = [];

    try {
      await mkdir(dirname(absPath), { recursive: true });
      const stamp = new Date().toISOString();
      const body =
        target.endsWith(".md") || !target.includes(".")
          ? stubMarkdown(order, stamp)
          : stubCodeComment(order, stamp);
      await writeFile(absPath, body, { flag: "a" }).catch(async () => {
        await writeFile(absPath, body);
      });
      filesTouched.push(target);
      io.onEvent({ type: "file_edit", at: new Date().toISOString(), data: { path: target, action: "append" } });
    } catch (err) {
      log.warn(`native stub write failed: ${(err as Error).message}`);
      io.onEvent({ type: "error", at: new Date().toISOString(), data: { message: (err as Error).message } });
      return {
        run_id: order.run_id,
        status: "failed",
        files_touched: [],
        drift: [],
        diff_artifact: null,
        tokens: 0,
        cost: 0,
        summary: "native stub failed to write placeholder",
      };
    }

    io.onEvent({ type: "status", at: new Date().toISOString(), data: { runner: this.id, state: "done" } });

    // Drift audit is owned by orchestration; we report no drift from the stub.
    return {
      run_id: order.run_id,
      status: "succeeded",
      files_touched: filesTouched,
      drift: [],
      diff_artifact: null,
      tokens: 0,
      cost: 0,
      summary: `native stub appended a placeholder to ${target} (Claude Code unavailable)`,
    };
  }

  async cancel(runId: string): Promise<void> {
    log.info(`cancel requested for ${runId} (native stub — no-op)`);
  }
}

function stubMarkdown(order: WorkOrder, stamp: string): string {
  return `\n## Trellis native runner (stub) — ${stamp}\n\nGoal: ${order.goal}\n\nAssumptions:\n${order.assumptions.map((a) => `- ${a}`).join("\n") || "- (none)"}\n\nRisks:\n${order.risks.map((r) => `- ${r}`).join("\n") || "- (none)"}\n\n> Replace with a real implementation. This file was written by the native fallback runner because Claude Code was not available.\n`;
}

function stubCodeComment(order: WorkOrder, stamp: string): string {
  return `\n// TODO(trellis,${stamp}): ${order.goal}\n// Assumptions: ${order.assumptions.join("; ") || "none"}\n// Risks: ${order.risks.join("; ") || "none"}\n// (native fallback runner stub — implement this)\n`;
}

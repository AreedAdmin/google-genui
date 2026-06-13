import { randomUUID } from "node:crypto";
import type { AgentRunner, WorkOrder, RunnerResult, RunnerIO } from "@trellis/shared";
import { env } from "../env.js";
import { logger } from "../log.js";

const log = logger("a2a-runner");

/**
 * A2aRemoteRunner — dispatches an approved node's WorkOrder to a remote, A2A-
 * speaking coding agent (agent-runners.md runner boundary = A2A;
 * mandated-integrations.md §3.2). Trellis's orchestrator is the A2A *client*; the
 * remote agent (Agent Card at A2A_RUNNER_CARD_URL) is the A2A *remote agent*.
 * Internal orchestration stays on BullMQ — this only crosses the runner boundary.
 *
 * Fallback-safe per the MVP "degrade, don't crash" rule: a missing card URL or any
 * transport error returns a failed RunnerResult (the pipeline still records the run
 * + status), and never throws into the worker.
 */
export class A2aRemoteRunner implements AgentRunner {
  readonly id = "a2a_remote";

  async start(order: WorkOrder, io: RunnerIO): Promise<RunnerResult> {
    const cardUrl = env.a2aRunnerCardUrl;
    const failed = (summary: string): RunnerResult => ({
      run_id: order.run_id,
      status: "failed",
      files_touched: [],
      drift: [],
      diff_artifact: null,
      tokens: 0,
      cost: 0,
      summary,
    });

    if (!cardUrl) {
      log.warn("A2A_RUNNER_CARD_URL not set; cannot dispatch to a remote A2A runner");
      io.onEvent({
        type: "error",
        at: new Date().toISOString(),
        data: { message: "A2A runner not configured (set A2A_RUNNER_CARD_URL)" },
      });
      return failed("A2A runner not configured: set A2A_RUNNER_CARD_URL to a remote agent's Agent Card");
    }

    try {
      // Lazy import keeps the SDK off the hot path for the default runners.
      const { A2AClient } = await import("@a2a-js/sdk/client");
      const client = await A2AClient.fromCardUrl(cardUrl);
      io.onEvent({
        type: "status",
        at: new Date().toISOString(),
        data: { runner: this.id, state: "running", card: cardUrl },
      });

      const params = {
        message: {
          kind: "message" as const,
          messageId: randomUUID(),
          role: "user" as const,
          parts: [{ kind: "text" as const, text: buildPrompt(order) }],
        },
      };

      let lastText = "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = client.sendMessageStream(params as any);
      for await (const event of stream) {
        const chunk = extractText(event);
        if (chunk) {
          lastText = chunk;
          io.onEvent({ type: "text", at: new Date().toISOString(), data: { text: chunk } });
        }
      }

      io.onEvent({ type: "status", at: new Date().toISOString(), data: { runner: this.id, state: "done" } });
      return {
        run_id: order.run_id,
        status: "succeeded",
        files_touched: [],
        drift: [],
        diff_artifact: null,
        tokens: 0,
        cost: 0,
        summary: lastText || "A2A remote runner completed",
      };
    } catch (err) {
      const msg = (err as Error).message;
      log.warn(`A2A dispatch failed: ${msg}`);
      io.onEvent({ type: "error", at: new Date().toISOString(), data: { message: msg } });
      return failed(`A2A remote runner error: ${msg}`);
    }
  }

  async cancel(runId: string): Promise<void> {
    log.info(`cancel requested for ${runId} (A2A remote — handled by the remote task lifecycle)`);
  }
}

function buildPrompt(order: WorkOrder): string {
  return [
    `Goal: ${order.goal}`,
    order.touch_set.allowed_files.length ? `Allowed files: ${order.touch_set.allowed_files.join(", ")}` : "",
    order.assumptions.length ? `Assumptions: ${order.assumptions.join("; ")}` : "",
    order.risks.length ? `Risks: ${order.risks.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A2A stream events are a union (Message | Task | status/artifact updates); pull any text parts. */
function extractText(event: unknown): string | null {
  const e = event as {
    parts?: Array<{ kind?: string; text?: string }>;
    status?: { message?: { parts?: Array<{ kind?: string; text?: string }> } };
  };
  const parts = e?.parts ?? e?.status?.message?.parts ?? [];
  const texts = parts.filter((p) => p?.kind === "text" && typeof p.text === "string").map((p) => p.text as string);
  return texts.length ? texts.join("") : null;
}

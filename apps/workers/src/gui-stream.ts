import { keys } from "@trellis/shared";
import { EventType } from "@ag-ui/core";
import { createRedis } from "./queue.js";
import { logger } from "./log.js";

const log = logger("gui-stream");

/**
 * GuiStream — emits standard AG-UI events (@ag-ui/core `EventType`) to the Redis
 * stream `stream:gui:{plan_id}`. The api relays this as SSE and CopilotKit /
 * @ag-ui/client consume it to drive the React Flow canvas
 * (mandated-integrations.md §3.1 / §4).
 *
 * STRUCTURED events only — the raw token/diff/log firehose stays on
 * `stream:run:{run_id}` (the resolved Option B two-plane split). Each entry stores
 * the full AG-UI event JSON under the `payload` field. Best-effort: a failed write
 * logs but never throws, so emitting AG-UI can never break the build pipeline.
 */
export class GuiStream {
  private readonly key: string;
  private readonly conn = createRedis();

  constructor(private readonly planId: string) {
    this.key = keys.guiStream(planId);
  }

  private async push(event: Record<string, unknown>): Promise<void> {
    try {
      await this.conn.xadd(this.key, "*", "payload", JSON.stringify(event));
    } catch (err) {
      log.warn(`gui xadd failed for ${this.key}`, err);
    }
  }

  /** Lifecycle: a plan-build / node-run run started (threadId = plan). */
  runStarted(runId: string): Promise<void> {
    return this.push({ type: EventType.RUN_STARTED, threadId: this.planId, runId });
  }

  /** Lifecycle: run finished cleanly. */
  runFinished(runId: string, result?: unknown): Promise<void> {
    return this.push({ type: EventType.RUN_FINISHED, threadId: this.planId, runId, result });
  }

  /** Lifecycle: run errored. */
  runError(message: string): Promise<void> {
    return this.push({ type: EventType.RUN_ERROR, message });
  }

  /** Full plan-graph snapshot the canvas hydrates from (STATE_SNAPSHOT). */
  stateSnapshot(snapshot: unknown): Promise<void> {
    return this.push({ type: EventType.STATE_SNAPSHOT, snapshot });
  }

  /** A typed custom event (e.g. `node_status`) the canvas projects onto a node. */
  custom(name: string, value: unknown): Promise<void> {
    return this.push({ type: EventType.CUSTOM, name, value });
  }

  async close(): Promise<void> {
    try {
      this.conn.disconnect();
    } catch {
      /* ignore */
    }
  }
}

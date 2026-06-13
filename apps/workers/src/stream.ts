import { keys, type RunnerEvent } from "@trellis/shared";
import { createRedis } from "./queue.js";
import { logger } from "./log.js";

const log = logger("stream");

/**
 * Redis-stream writer for live run feeds. The canvas tails `stream:run:{run_id}`
 * via the api's SSE endpoint (parallel-orchestration.md §7); every RunnerEvent
 * (text / tool_call / file_edit / token_usage / error / status) is XADD'd here.
 *
 * Each writer owns its own ioredis connection so a slow/blocked write never
 * starves the queue connection.
 */
export class RunStream {
  private readonly key: string;
  private readonly conn = createRedis();

  constructor(runId: string) {
    this.key = keys.runStream(runId);
  }

  /** Push one RunnerEvent. Best-effort: a failed write logs but never throws. */
  async push(event: RunnerEvent): Promise<void> {
    try {
      await this.conn.xadd(
        this.key,
        "*",
        "type",
        event.type,
        "at",
        event.at,
        "data",
        JSON.stringify(event.data ?? {}),
      );
    } catch (err) {
      log.warn(`xadd failed for ${this.key}`, err);
    }
  }

  /** Convenience: timestamped event with the current time. */
  async emit(type: RunnerEvent["type"], data: Record<string, unknown> = {}): Promise<void> {
    await this.push({ type, at: new Date().toISOString(), data });
  }

  async close(): Promise<void> {
    try {
      this.conn.disconnect();
    } catch {
      /* ignore */
    }
  }
}

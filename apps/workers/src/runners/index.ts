import type { AgentRunner, ExecutionBackend } from "@trellis/shared";
import { ClaudeCodeRunner } from "./claude-code.js";
import { NativeRunner } from "./native.js";
import { logger } from "../log.js";

const log = logger("runner-registry");

/**
 * Runner registry (agent-runners.md §3). Resolves the AgentRunner for a given
 * execution_backend (project default -> plan override -> run record). Orchestration
 * stays runner-agnostic; only this map knows the concrete implementations.
 */
const registry: Record<ExecutionBackend, () => AgentRunner> = {
  claude_code: () => new ClaudeCodeRunner(),
  native: () => new NativeRunner(),
};

export function getRunner(backend: string | null | undefined): AgentRunner {
  const key = (backend ?? "claude_code") as ExecutionBackend;
  const make = registry[key];
  if (!make) {
    log.warn(`unknown execution_backend "${backend}"; defaulting to claude_code`);
    return new ClaudeCodeRunner();
  }
  return make();
}

export { ClaudeCodeRunner, NativeRunner };

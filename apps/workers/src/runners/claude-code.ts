import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { AgentRunner, WorkOrder, RunnerResult, RunnerIO, RunnerEvent } from "@trellis/shared";
import { env } from "../env.js";
import { logger } from "../log.js";
import { NativeRunner } from "./native.js";

const log = logger("claude-code-runner");

/**
 * ClaudeCodeRunner (agent-runners.md §4). Drives headless Claude Code against a
 * pre-created worktree:
 *
 *   CLAUDE_CODE_PATH -p "<prompt>" --output-format stream-json --verbose
 *     --permission-mode <mode> --max-turns N         (cwd = worktree)
 *
 * with an injected CLAUDE.md carrying touch-set guardrails + assumptions + risks.
 * stream-json lines are parsed -> RunnerEvents pushed to the run stream (the
 * worker relays to stream:run:{id}). On exit the worker harvests `git diff` and
 * audits drift; the runner just reports files it observed editing + usage.
 *
 * If the binary is absent / unspawnable, we degrade to the NativeRunner so the
 * worker never crashes.
 */
export class ClaudeCodeRunner implements AgentRunner {
  readonly id = "claude_code";
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly runs = new Map<string, ChildProcessWithoutNullStreams>();

  async start(order: WorkOrder, io: RunnerIO): Promise<RunnerResult> {
    const available = await this.binaryAvailable();
    if (!available) {
      log.warn(`Claude Code binary not found at ${env.claudeCodePath}; falling back to NativeRunner`);
      io.onEvent({
        type: "status",
        at: new Date().toISOString(),
        data: { runner: this.id, state: "fallback", reason: "binary_unavailable" },
      });
      return new NativeRunner().start(order, io);
    }

    await this.injectClaudeMd(order);

    const prompt = renderPrompt(order);
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      env.claudeCodePermissionMode,
      "--max-turns",
      String(order.policy.max_turns ?? env.claudeCodeMaxTurns),
      "--model",
      env.claudeCodeModel,
    ];

    log.info(`spawning claude code in ${order.worktree_path} (run ${order.run_id})`);
    io.onEvent({ type: "status", at: new Date().toISOString(), data: { runner: this.id, state: "starting" } });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(env.claudeCodePath, args, {
        cwd: order.worktree_path,
        env: { ...process.env, ANTHROPIC_API_KEY: env.anthropicApiKey },
      });
    } catch (err) {
      log.warn(`spawn failed (${(err as Error).message}); falling back to NativeRunner`);
      return new NativeRunner().start(order, io);
    }

    this.child = child;
    this.runs.set(order.run_id, child);

    const filesTouched = new Set<string>();
    let tokens = 0;
    let cost = 0;
    let summary = "";

    const rl = createInterface({ input: child.stdout });

    // Wall-clock guard.
    const wallclockMs = (order.policy.wallclock_s ?? 900) * 1000;
    const killTimer = setTimeout(() => {
      log.warn(`run ${order.run_id} exceeded wallclock; killing`);
      child.kill("SIGKILL");
    }, wallclockMs);

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: StreamJson;
      try {
        msg = JSON.parse(trimmed) as StreamJson;
      } catch {
        // Non-JSON noise from the binary — relay as text.
        io.onEvent({ type: "text", at: new Date().toISOString(), data: { text: trimmed } });
        return;
      }
      const out = mapStreamJson(msg, filesTouched);
      if (out.tokens) tokens += out.tokens;
      if (out.cost) cost += out.cost;
      if (out.summary) summary = out.summary;
      for (const ev of out.events) io.onEvent(ev);
    });

    child.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString().trim();
      if (text) io.onEvent({ type: "text", at: new Date().toISOString(), data: { stderr: text } });
    });

    const status = await new Promise<RunnerResult["status"]>((resolve) => {
      child.on("error", (err) => {
        io.onEvent({ type: "error", at: new Date().toISOString(), data: { message: err.message } });
        resolve("failed");
      });
      child.on("close", (code, signal) => {
        clearTimeout(killTimer);
        if (signal === "SIGKILL") resolve("cancelled");
        else resolve(code === 0 ? "succeeded" : "failed");
      });
    });

    this.runs.delete(order.run_id);
    this.child = null;

    io.onEvent({ type: "status", at: new Date().toISOString(), data: { runner: this.id, state: status } });

    return {
      run_id: order.run_id,
      status,
      files_touched: [...filesTouched],
      drift: [], // computed by orchestration from the git diff
      diff_artifact: null,
      tokens,
      cost,
      summary: summary || `claude code ${status}`,
    };
  }

  async cancel(runId: string): Promise<void> {
    const child = this.runs.get(runId) ?? this.child;
    if (child) {
      log.info(`cancelling run ${runId}`);
      child.kill("SIGTERM");
    }
  }

  private async binaryAvailable(): Promise<boolean> {
    try {
      await access(env.claudeCodePath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** Inject CLAUDE.md guardrails into the worktree (agent-runners.md §4.1). */
  private async injectClaudeMd(order: WorkOrder): Promise<void> {
    const md = `# Trellis build guardrails

You are implementing ONE plan node inside this worktree. Trellis adjudicates the final diff.

## Goal
${order.goal}

## Touch-set — edit ONLY these files/symbols
Allowed files:
${order.touch_set.allowed_files.map((f) => `- ${f}`).join("\n") || "- (none predicted — stay minimal)"}
Allowed symbols:
${order.touch_set.allowed_symbols.map((s) => `- ${s}`).join("\n") || "- (none predicted)"}
Signatures in scope:
${order.touch_set.signatures.map((s) => `- ${s}`).join("\n") || "- (none)"}

If you must touch a file outside this set, do it minimally — Trellis will flag it as drift.

## Assumptions (treat as given)
${order.assumptions.map((a) => `- ${a}`).join("\n") || "- (none)"}

## Risks / failure modes to avoid
${order.risks.map((r) => `- ${r}`).join("\n") || "- (none)"}

## Acceptance
Tests: ${order.acceptance.tests.join(", ") || "(none specified)"}
Commands: ${order.acceptance.commands.join(", ") || "(none specified)"}
`;
    try {
      await writeFile(join(order.worktree_path, "CLAUDE.md"), md);
    } catch (err) {
      log.warn(`could not write CLAUDE.md: ${(err as Error).message}`);
    }
  }
}

function renderPrompt(order: WorkOrder): string {
  return [
    `Implement this change in the current repository worktree.`,
    ``,
    `Goal: ${order.goal}`,
    ``,
    `Read CLAUDE.md in the repo root for the touch-set guardrails, assumptions, and risks — stay within them.`,
    order.acceptance.commands.length
      ? `When done, run: ${order.acceptance.commands.join(" && ")}`
      : `When done, ensure the code builds.`,
  ].join("\n");
}

// ---- stream-json parsing (Claude Code headless event shapes) ----

interface StreamJson {
  type?: string;
  subtype?: string;
  message?: {
    content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  // result / cost fields on the terminal "result" event
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  result?: string;
  // tool_use / tool name shortcuts
  name?: string;
  input?: Record<string, unknown>;
}

function mapStreamJson(
  msg: StreamJson,
  filesTouched: Set<string>,
): { events: RunnerEvent[]; tokens?: number; cost?: number; summary?: string } {
  const at = new Date().toISOString();
  const events: RunnerEvent[] = [];
  let tokens = 0;
  let cost = 0;
  let summary = "";

  // Assistant turns: text + tool_use blocks.
  if (msg.type === "assistant" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text) {
        events.push({ type: "text", at, data: { text: block.text } });
      } else if (block.type === "tool_use") {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const path = pickEditedPath(block.name, input);
        if (path) {
          filesTouched.add(path);
          events.push({ type: "file_edit", at, data: { tool: block.name, path } });
        } else {
          events.push({ type: "tool_call", at, data: { tool: block.name, input } });
        }
      }
    }
    if (msg.message.usage) {
      tokens = (msg.message.usage.input_tokens ?? 0) + (msg.message.usage.output_tokens ?? 0);
      if (tokens) events.push({ type: "token_usage", at, data: { tokens } });
    }
  }

  // Terminal result event with cost + final usage.
  if (msg.type === "result") {
    if (msg.total_cost_usd) cost = msg.total_cost_usd;
    if (msg.usage) tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
    if (msg.result) summary = msg.result.slice(0, 500);
    events.push({ type: "status", at, data: { result: msg.subtype ?? "result", cost, tokens } });
  }

  return { events, tokens, cost, summary };
}

/** Extract an edited file path from a tool_use input, when the tool is a writer. */
function pickEditedPath(name: string | undefined, input: Record<string, unknown>): string | null {
  const writers = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "str_replace_based_edit_tool"]);
  if (!name || !writers.has(name)) return null;
  const p = input.file_path ?? input.path;
  return typeof p === "string" ? p : null;
}

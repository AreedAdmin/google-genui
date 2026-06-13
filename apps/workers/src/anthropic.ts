import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { env } from "./env.js";
import { logger } from "./log.js";

const log = logger("anthropic");

/**
 * Anthropic client + the tool-forced-JSON helper every agent is built on
 * (prompts-and-tools.md §4): exactly one terminal `emit_*` tool, output validated
 * by zod, bounded repair (≤2 retries re-prompting with the exact validator error),
 * then a thrown error that marks the run failed.
 *
 * Models: Planner / Analysis = Opus (claude-opus-4-8); Widget = Sonnet
 * (claude-sonnet-4-6). Opus 4.8 takes adaptive thinking; no sampling params.
 */

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!_client) {
    if (!env.anthropicApiKey) {
      // We still construct; the SDK reads ANTHROPIC_API_KEY from env. If truly
      // absent, calls will 401 — callers degrade rather than the process dying.
      log.warn("ANTHROPIC_API_KEY is empty — model calls will fail until set");
    }
    _client = new Anthropic({ apiKey: env.anthropicApiKey || undefined });
  }
  return _client;
}

/** A JSON-Schema object describing the single forced emit_* tool's input. */
export type JsonSchema = Record<string, unknown>;

/**
 * An agentic tool the model may call zero or more times BEFORE the terminal
 * emit_* tool (prompts-and-tools.md). `execute` runs the tool and returns a
 * string fed back as a tool_result. Supplied via ToolForcedOptions.agentTools.
 */
export interface AgentTool {
  definition: Anthropic.Tool;
  execute: (input: any) => Promise<string>;
}

export interface ToolForcedOptions<T> {
  model: string;
  system: string | Anthropic.TextBlockParam[];
  /** The user/task payload turn(s). */
  prompt: string;
  /** The terminal tool name, e.g. "emit_plan". */
  toolName: string;
  toolDescription: string;
  inputSchema: JsonSchema;
  /** Zod schema validating the tool input we get back. `any` input so T resolves
   *  to the schema's OUTPUT type (defaults applied), not its input type. */
  validator: z.ZodType<T, z.ZodTypeDef, any>;
  maxTokens?: number;
  /** ≤2 per prompts-and-tools.md §4. */
  maxRepair?: number;
  /** Optional tools the model may call on demand before the terminal tool (e.g.
   *  web_search/Linkup). Present → an agentic loop (tool_choice "any"); omitted →
   *  the classic single forced terminal-tool call (existing callers unchanged). */
  agentTools?: AgentTool[];
  /** Max agent-tool calls before the terminal tool is forced (default 4). */
  maxToolCalls?: number;
}

export interface ToolForcedResult<T> {
  data: T;
  tokens: number;
  model: string;
  /** How many agent-tool calls (e.g. web_search) the model made. */
  toolCalls: number;
}

/**
 * Run a tool-forced JSON turn and return zod-validated output. With `agentTools`
 * the model may first call those tools on demand (each result fed back), then the
 * terminal tool; once `maxToolCalls` is hit the terminal tool is forced so the
 * loop always terminates. Throws after `maxRepair` failed validations.
 */
export async function toolForcedJSON<T>(opts: ToolForcedOptions<T>): Promise<ToolForcedResult<T>> {
  const {
    model,
    system,
    prompt,
    toolName,
    toolDescription,
    inputSchema,
    validator,
    maxTokens = 8000,
    maxRepair = 2,
    agentTools = [],
    maxToolCalls = 4,
  } = opts;

  const client = anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let tokens = 0;
  let toolCalls = 0; // agent-tool (e.g. web_search) invocations
  let repairs = 0;
  let lastError = "";

  const terminalTool: Anthropic.Tool = {
    name: toolName,
    description: toolDescription,
    input_schema: inputSchema as Anthropic.Tool.InputSchema,
  };
  const executors = new Map(agentTools.map((t) => [t.definition.name, t.execute]));
  const agentDefs = agentTools.map((t) => t.definition);

  // Backstop so a misbehaving model can never loop forever.
  const maxIterations = maxRepair + maxToolCalls + 4;

  for (let i = 0; i < maxIterations; i++) {
    // Force the terminal tool once the tool-call budget is spent (or when there
    // are no agent tools at all — the classic single-shot path).
    const forceTerminal = agentTools.length === 0 || toolCalls >= maxToolCalls;
    const tool_choice: Anthropic.MessageCreateParams["tool_choice"] = forceTerminal
      ? { type: "tool", name: toolName }
      : { type: "any", disable_parallel_tool_use: true };

    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: [terminalTool, ...agentDefs],
      tool_choice,
      messages,
    });

    tokens += (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0);

    // (1) Terminal tool → validate and return (bounded repair on failure).
    const terminalUse = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === toolName,
    );
    if (terminalUse) {
      const parsed = validator.safeParse(terminalUse.input);
      if (parsed.success) return { data: parsed.data, tokens, model, toolCalls };

      lastError = parsed.error.issues
        .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
        .join("; ");
      log.warn(`attempt ${i}: schema validation failed: ${lastError}`);
      if (repairs++ >= maxRepair) break;
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: `The ${toolName} input failed validation. Fix these errors and call ${toolName} again with corrected input:\n${lastError}`,
      });
      continue;
    }

    // (2) Agent-tool calls (e.g. web_search) → execute each, feed results back.
    const agentUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && executors.has(b.name),
    );
    if (agentUses.length > 0) {
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of agentUses) {
        let out: string;
        try {
          out = await executors.get(use.name)!(use.input);
        } catch (err) {
          out = `tool error: ${(err as Error).message}`;
        }
        results.push({ type: "tool_result", tool_use_id: use.id, content: out });
        toolCalls++;
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // (3) No tool call at all (text only) → re-prompt to call the terminal tool.
    lastError = `model did not call ${toolName} (stop_reason=${res.stop_reason})`;
    log.warn(`attempt ${i}: ${lastError}`);
    if (repairs++ >= maxRepair) break;
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: `You must call the ${toolName} tool with valid input. ${lastError}`,
    });
  }

  throw new Error(
    `toolForcedJSON(${toolName}) failed after ${repairs} repair(s) / ${toolCalls} tool call(s): ${lastError}`,
  );
}

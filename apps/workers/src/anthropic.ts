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
}

export interface ToolForcedResult<T> {
  data: T;
  tokens: number;
  model: string;
}

/**
 * Run a tool-forced JSON turn and return zod-validated output.
 * Throws after `maxRepair` failed validations (caller marks the run failed).
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
  } = opts;

  const client = anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let tokens = 0;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRepair; attempt++) {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: [
        {
          name: toolName,
          description: toolDescription,
          input_schema: inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: toolName },
      messages,
    });

    tokens += (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0);

    const toolUse = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === toolName,
    );

    if (!toolUse) {
      lastError = `model did not call ${toolName} (stop_reason=${res.stop_reason})`;
      log.warn(`attempt ${attempt}: ${lastError}`);
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: `You must call the ${toolName} tool with valid input. ${lastError}`,
      });
      continue;
    }

    const parsed = validator.safeParse(toolUse.input);
    if (parsed.success) {
      return { data: parsed.data, tokens, model };
    }

    lastError = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    log.warn(`attempt ${attempt}: schema validation failed: ${lastError}`);

    // Bounded repair: re-prompt with the exact validator error.
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content:
        `The ${toolName} input failed validation. Fix these errors and call ` +
        `${toolName} again with corrected input:\n${lastError}`,
    });
  }

  throw new Error(`toolForcedJSON(${toolName}) exhausted ${maxRepair} repairs: ${lastError}`);
}

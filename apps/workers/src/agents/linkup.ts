import { LinkupClient } from "linkup-sdk";
import type { AgentTool } from "../anthropic.js";
import { env } from "../env.js";
import { logger } from "../log.js";

const log = logger("linkup");

export interface WebGrounding {
  answer: string;
  sources: Array<{ name?: string; url: string; snippet?: string }>;
}

let _client: LinkupClient | null = null;
function client(): LinkupClient | null {
  if (!env.linkupApiKey) return null;
  if (!_client) _client = new LinkupClient({ apiKey: env.linkupApiKey });
  return _client;
}

/**
 * Linkup web-search grounding (mandated-integrations.md §3.3). Gives the
 * Planner / Analysis agents *external* world knowledge (library docs,
 * deprecations, current APIs) — kept DISTINCT from repo-symbol grounding so the
 * "grounded in real symbols" guarantee (P2) is never diluted. Callers MUST label
 * this evidence `web:linkup`.
 *
 * Fallback-safe per the MVP "degrade, don't crash" rule: returns null when no
 * LINKUP_API_KEY is set or on any error, so the agent simply proceeds without it.
 */
export async function webSearch(query: string): Promise<WebGrounding | null> {
  const c = client();
  if (!c) return null;
  try {
    const res = (await c.search({
      query,
      depth: "standard",
      outputType: "sourcedAnswer",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as { answer?: string; sources?: Array<{ name?: string; url?: string; snippet?: string }> };
    return {
      answer: res.answer ?? "",
      sources: (res.sources ?? [])
        .filter((s) => typeof s.url === "string")
        .map((s) => ({ name: s.name, url: s.url as string, snippet: s.snippet })),
    };
  } catch (err) {
    log.warn(`linkup search failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Linkup as an on-demand agent tool (mandated-integrations.md §3.3 / Task 2):
 * the Planner / Analysis loop registers this alongside their terminal emit_* tool,
 * so the model decides WHEN to search and WITH WHAT query. Always returns a
 * tool_result string (even on no key / error), tagged `web:linkup` so the model
 * never confuses it with repo-symbol grounding.
 */
export const webSearchTool: AgentTool = {
  definition: {
    name: "web_search",
    description:
      "Search the web for EXTERNAL, non-repo knowledge: library deprecations, current API " +
      "signatures/usage, known footguns, and best practices. Returns a sourced answer with URLs. " +
      "Results are web:linkup — NOT repo-verified; use them to inform reasoning, never as repo grounding.",
    input_schema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string", description: "The web search query." } },
    },
  },
  execute: async (input: { query?: string }) => {
    const r = await webSearch(String(input?.query ?? ""));
    if (!r?.answer) return "No web results.";
    const srcs = r.sources
      .slice(0, 5)
      .map((s) => s.url)
      .join("\n");
    return `web:linkup result (NOT repo-verified):\n${r.answer}${srcs ? `\nSources:\n${srcs}` : ""}`;
  },
};

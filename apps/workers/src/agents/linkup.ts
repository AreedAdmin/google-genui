import { LinkupClient } from "linkup-sdk";
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

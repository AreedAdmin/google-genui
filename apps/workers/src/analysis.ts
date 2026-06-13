import { env } from "./env.js";
import { logger } from "./log.js";

const log = logger("analysis");

/**
 * Typed, best-effort HTTP client for the Python dependency-analysis service
 * (dependency-inference-engine.md §7). Field names match services/analysis
 * pydantic models exactly.
 *
 * Every method is best-effort: on a network error / non-2xx the method returns
 * `null` and logs, so the pipeline can fall back to TS-side heuristics rather
 * than crash (the analysis service is allowed to be absent in the MVP).
 */

// ---- wire shapes (mirror services/analysis/app/models.py) ----

export interface PredictedSymbol {
  kind: string;
  name: string;
  file?: string | null;
  change_signature?: boolean;
}
export interface PredictedTouchSet {
  add: PredictedSymbol[];
  modify: PredictedSymbol[];
  delete: PredictedSymbol[];
  schema_keys?: string[];
  config_keys?: string[];
}
export interface ResolvedTouchSet {
  files: string[];
  symbols: string[];
  signatures_changed: string[];
  schema_keys: string[];
  config_keys: string[];
}
export interface BlastRadius {
  callers: string[];
  signature_call_sites: string[];
  type_refs: string[];
  files: string[];
  symbols: string[];
}
export interface ResolveTouchsetResponse {
  resolved: ResolvedTouchSet;
  blast_radius: BlastRadius;
  confidence: number;
  matches: unknown[];
  new_symbols: string[];
}
export interface SharedSets {
  files: string[];
  symbols: string[];
  signatures: string[];
  schema: string[];
  config: string[];
}
export interface OverlapResponse {
  overlap_score: number;
  shared: SharedSets;
  hard_conflict: boolean;
}
export interface CallgraphImpactResponse {
  affected_symbols: string[];
  affected_files: string[];
  root: string | null;
}
export interface IndexResponse {
  index_id: string;
  stats: Record<string, unknown>;
}

async function post<T>(path: string, body: unknown, timeoutMs = 20000): Promise<T | null> {
  const url = `${env.analysisServiceUrl}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      log.warn(`POST ${path} -> ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    log.warn(`POST ${path} unreachable; degrading`, (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const analysisService = {
  /** POST /index — best-effort repo indexing. */
  index(projectId: string, repoPath: string, commit: string): Promise<IndexResponse | null> {
    return post<IndexResponse>("/index", { project_id: projectId, repo_path: repoPath, commit }, 120000);
  },

  /** POST /resolve-touchset — predicted -> resolved symbols + blast radius. */
  resolveTouchset(
    projectId: string,
    commit: string,
    predicted: PredictedTouchSet,
  ): Promise<ResolveTouchsetResponse | null> {
    return post<ResolveTouchsetResponse>("/resolve-touchset", {
      project_id: projectId,
      commit,
      predicted_touchset: predicted,
    });
  },

  /** POST /overlap — pairwise file/symbol/signature/schema/config overlap. */
  overlap(
    projectId: string,
    commit: string,
    a: ResolvedTouchSet,
    b: ResolvedTouchSet,
  ): Promise<OverlapResponse | null> {
    return post<OverlapResponse>("/overlap", {
      project_id: projectId,
      commit,
      touchset_a: a,
      touchset_b: b,
    });
  },

  /** POST /callgraph-impact — reverse reachability for a symbol. */
  callgraphImpact(
    projectId: string,
    commit: string,
    symbol: string,
    kind: "signature" | "body" = "signature",
  ): Promise<CallgraphImpactResponse | null> {
    return post<CallgraphImpactResponse>("/callgraph-impact", {
      project_id: projectId,
      commit,
      symbol,
      kind,
    });
  },
};

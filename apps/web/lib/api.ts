import type {
  PlanGraph,
  Plan,
  Run,
  Share,
  Delegation,
  CreatePlanRequest,
  ReplanRequest,
  RunSelectionRequest,
  DelegateRequest,
  ShareRequest,
} from "@trellis/shared";

/**
 * Typed client for the Fastify orchestration API (api-design.md /v1).
 * Every error is normalized to ApiClientError carrying the stable `code`
 * from the server's error envelope (apps/api/src/errors.ts).
 */

export const API_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
  "http://localhost:8080";

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Bearer token (Supabase session JWT) when available. */
  token?: string;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    throw new ApiClientError(
      "network_error",
      err instanceof Error ? err.message : "Network request failed",
      0,
    );
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const envelope = payload as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiClientError(
      envelope?.error?.code ?? "http_error",
      envelope?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      envelope?.error?.details,
    );
  }

  return payload as T;
}

/** A project list entry as returned by GET /v1/projects (with a plan rollup). */
export interface ProjectListItem {
  id: string;
  name: string;
  repo_url: string;
  default_branch: string;
  languages: string[];
  plan_count: number;
  updated_at: string;
}

/** A plan summary row for the project / home list. */
export interface PlanListItem {
  id: string;
  project_id: string;
  title: string;
  prompt: string;
  granularity: Plan["granularity"];
  status: Plan["status"];
  node_count: number;
  updated_at: string;
}

export const api = {
  // ---- projects + plans list (home) ----
  listProjects: (token?: string) =>
    request<ProjectListItem[]>("/v1/projects", { token }),

  listPlans: (token?: string) => request<PlanListItem[]>("/v1/plans", { token }),

  // ---- plan lifecycle ----
  createPlan: (body: CreatePlanRequest, token?: string) =>
    request<{ id: string }>("/v1/plans", { method: "POST", body, token }),

  getPlan: (id: string, token?: string, signal?: AbortSignal) =>
    request<PlanGraph>(`/v1/plans/${id}`, { token, signal }),

  replan: (id: string, body: ReplanRequest, token?: string) =>
    request<{ revision: number }>(`/v1/plans/${id}/replan`, {
      method: "POST",
      body,
      token,
    }),

  // ---- operate ----
  run: (id: string, body: RunSelectionRequest, token?: string) =>
    request<{ runs: Run[] }>(`/v1/plans/${id}/run`, {
      method: "POST",
      body,
      token,
    }),

  delegate: (id: string, body: DelegateRequest, token?: string) =>
    request<Delegation>(`/v1/plans/${id}/delegate`, {
      method: "POST",
      body,
      token,
    }),

  share: (body: ShareRequest, token?: string) =>
    request<Share>("/v1/shares", { method: "POST", body, token }),

  // ---- per-claim feedback (node-inspector.md §5) ----
  feedback: (
    body: { node_id: string; annotation_path: string; vote: "up" | "down"; reason?: string },
    token?: string,
  ) => request<{ ok: true }>("/v1/feedback", { method: "POST", body, token }),
};

/**
 * Subscribe to a run's live event stream — GET /v1/runs/:id/stream (SSE).
 * Returns an unsubscribe function. Each parsed RunnerEvent-ish payload is
 * delivered to `onEvent`; transport errors go to `onError`.
 */
export interface RunStreamEvent {
  type: string;
  at?: string;
  data?: Record<string, unknown>;
}

export function subscribeRunStream(
  runId: string,
  handlers: {
    onEvent: (e: RunStreamEvent) => void;
    onError?: (err: Error) => void;
    onDone?: () => void;
  },
): () => void {
  // EventSource cannot set Authorization headers; the API accepts the token as a
  // query param for the stream endpoint (api-design.md). It is short-lived.
  const url = `${API_URL}/v1/runs/${runId}/stream`;
  const es = new EventSource(url, { withCredentials: false });

  es.onmessage = (msg) => {
    if (!msg.data || msg.data === "[DONE]") {
      handlers.onDone?.();
      es.close();
      return;
    }
    try {
      handlers.onEvent(JSON.parse(msg.data) as RunStreamEvent);
    } catch {
      // tolerate keep-alive comments / partial frames
    }
  };

  es.onerror = () => {
    handlers.onError?.(new Error("Run stream disconnected"));
    es.close();
  };

  return () => es.close();
}

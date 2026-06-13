"use client";

import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";

/**
 * Browser Supabase client + realtime helper for the live canvas
 * (graph-canvas.md §7, realtime-ui.md). Subscribes to durable change feeds on
 * `plan_nodes` and `runs` scoped to a plan; the caller invalidates react-query
 * on each event. Returns null when env is unconfigured so the app still renders
 * (e.g. with fixture data) without realtime.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!URL || !ANON || ANON === "replace-with-supabase-anon-key") return null;
  client = createClient(URL, ANON, {
    realtime: { params: { eventsPerSecond: 10 } },
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export interface PlanRealtimeHandlers {
  onNodeChange?: (payload: RealtimePayload) => void;
  onRunChange?: (payload: RealtimePayload) => void;
  onEdgeChange?: (payload: RealtimePayload) => void;
  onBranchChange?: (payload: RealtimePayload) => void;
}

export interface RealtimePayload {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

/**
 * Subscribe to the live feeds for one plan. Returns an unsubscribe fn (no-op
 * when Supabase is unconfigured).
 */
export function subscribePlanRealtime(
  planId: string,
  handlers: PlanRealtimeHandlers,
): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};

  const channel: RealtimeChannel = sb.channel(`plan:${planId}`);

  const wrap =
    (fn?: (p: RealtimePayload) => void) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (payload: any) => {
      fn?.({
        eventType: payload.eventType,
        table: payload.table,
        new: payload.new ?? null,
        old: payload.old ?? null,
      });
    };

  channel
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "plan_nodes", filter: `plan_id=eq.${planId}` },
      wrap(handlers.onNodeChange),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "runs", filter: `plan_id=eq.${planId}` },
      wrap(handlers.onRunChange),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "plan_edges", filter: `plan_id=eq.${planId}` },
      wrap(handlers.onEdgeChange),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "branches", filter: `plan_id=eq.${planId}` },
      wrap(handlers.onBranchChange),
    )
    .subscribe();

  return () => {
    sb.removeChannel(channel);
  };
}

/** Best-effort current session access token for authorized API calls. */
export async function getAccessToken(): Promise<string | undefined> {
  const sb = getSupabase();
  if (!sb) return undefined;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token;
}

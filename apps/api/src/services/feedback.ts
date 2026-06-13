import type { Identity } from "../auth.js";
import { db } from "../supabase.js";

/** Feedback service — thumbs up/down on a node's analysis (the P2 trust loop). */
export interface FeedbackInput {
  vote: "up" | "down";
  reason?: string;
  annotation_path?: string;
}

export async function createFeedback(
  identity: Identity,
  nodeId: string,
  input: FeedbackInput,
) {
  const { data, error } = await db()
    .from("feedback")
    .insert({
      node_id: nodeId,
      vote: input.vote,
      reason: input.reason ?? null,
      annotation_path: input.annotation_path ?? null,
      user: identity.userId,
    })
    .select("*")
    .single();

  if (error) throw new Error(`createFeedback failed: ${error.message}`);
  return data;
}

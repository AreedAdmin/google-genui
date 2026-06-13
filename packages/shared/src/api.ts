import { z } from "zod";
import { Granularity, ShareRole } from "./enums.js";

/**
 * REST request/response DTOs — plan/01-architecture/api-design.md.
 * The api validates inbound bodies against these; the web client uses the types.
 */

export const CreatePlanRequest = z.object({
  project_id: z.string().uuid(),
  prompt: z.string().min(1),
  granularity: Granularity.optional(), // auto-detected if omitted
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;

export const ReplanRequest = z.object({
  context: z.string().min(1),
});
export type ReplanRequest = z.infer<typeof ReplanRequest>;

export const RunSelectionRequest = z.object({
  node_ids: z.array(z.string().uuid()).optional(),
  branch_ids: z.array(z.string().uuid()).optional(),
});
export type RunSelectionRequest = z.infer<typeof RunSelectionRequest>;

export const DelegateRequest = z.object({
  subtree_root_node: z.string().uuid(),
  assigned_to_email: z.string().email().optional(),
  assigned_to_user: z.string().uuid().optional(),
  role: ShareRole.default("runner"),
});
export type DelegateRequest = z.infer<typeof DelegateRequest>;

export const ShareRequest = z.object({
  resource_type: z.enum(["plan", "project"]),
  resource_id: z.string().uuid(),
  principal_email: z.string().email().optional(),
  principal_user: z.string().uuid().optional(),
  role: ShareRole,
});
export type ShareRequest = z.infer<typeof ShareRequest>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

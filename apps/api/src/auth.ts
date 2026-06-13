import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify } from "jose";
import { env, DEV_IDENTITY } from "./env.js";
import { ApiErrors } from "./errors.js";

/** The authenticated identity attached to every request. */
export interface Identity {
  userId: string;
  orgId: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    identity: Identity;
  }
}

/**
 * Verify a Supabase JWT (HS256, signed with SUPABASE_JWT_SECRET) and extract the
 * Trellis identity. `sub` is profiles.id; `org_id` and `email` are custom claims.
 */
export async function verifySupabaseJwt(token: string): Promise<Identity> {
  const secret = new TextEncoder().encode(env.jwtSecret());
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });

  const claims = payload as Record<string, unknown>;
  const userId = typeof claims.sub === "string" ? claims.sub : undefined;
  const orgId = typeof claims.org_id === "string" ? claims.org_id : undefined;
  const email = typeof claims.email === "string" ? claims.email : "";

  if (!userId) throw new Error("JWT missing sub claim");
  if (!orgId) throw new Error("JWT missing org_id claim");

  return { userId, orgId, email };
}

/**
 * Fastify preHandler: reads `Authorization: Bearer <jwt>`, verifies it, and
 * attaches `request.identity`. In development with no token, falls back to a
 * fixed dev identity (see DEV_IDENTITY + the seed in README).
 */
export async function authPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;

  if (!token) {
    if (env.isDev) {
      request.identity = { ...DEV_IDENTITY };
      return;
    }
    return ApiErrors.unauthenticated(reply, "Missing Authorization bearer token");
  }

  try {
    request.identity = await verifySupabaseJwt(token);
  } catch (err) {
    request.log.warn({ err }, "JWT verification failed");
    return ApiErrors.unauthenticated(reply, "Invalid or expired token");
  }
}

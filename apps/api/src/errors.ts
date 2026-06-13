import type { FastifyReply } from "fastify";
import type { ZodError } from "zod";

/**
 * Stable error envelope — api-design.md §9. Every error response shares this
 * shape; `code` is a machine-stable string the client can switch on.
 */

interface ErrorDetail {
  path: string;
  issue: string;
}

function send(
  reply: FastifyReply,
  http: number,
  code: string,
  message: string,
  extra?: { details?: unknown; retryable?: boolean },
): FastifyReply {
  return reply.code(http).send({
    error: {
      code,
      message,
      ...(extra?.details !== undefined ? { details: extra.details } : {}),
      retryable: extra?.retryable ?? false,
    },
  });
}

export const ApiErrors = {
  badRequest: (reply: FastifyReply, message = "Malformed request") =>
    send(reply, 400, "bad_request", message),

  unauthenticated: (reply: FastifyReply, message = "Missing or expired JWT") =>
    send(reply, 401, "unauthenticated", message),

  forbidden: (reply: FastifyReply, message = "Forbidden") =>
    send(reply, 403, "forbidden", message),

  notFound: (reply: FastifyReply, message = "Not found") =>
    send(reply, 404, "not_found", message),

  conflict: (reply: FastifyReply, message = "Conflict") =>
    send(reply, 409, "conflict", message),

  validationFailed: (reply: FastifyReply, error: ZodError) => {
    const details: ErrorDetail[] = error.issues.map((i) => ({
      path: i.path.join("."),
      issue: i.message,
    }));
    return send(reply, 422, "validation_failed", "Request body failed validation", {
      details,
    });
  },

  internal: (reply: FastifyReply, message = "Internal error") =>
    send(reply, 500, "internal", message, { retryable: false }),

  dependencyUnavailable: (reply: FastifyReply, message = "A dependency is unavailable") =>
    send(reply, 503, "dependency_unavailable", message, { retryable: true }),
};

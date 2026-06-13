import type { FastifyInstance } from "fastify";
import { CopilotRuntime, AnthropicAdapter, copilotRuntimeNodeHttpEndpoint } from "@copilotkit/runtime";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";

/**
 * CopilotKit runtime endpoint (mandated-integrations.md §6). Serves the
 * CopilotRuntime at /v1/copilotkit so the canvas's <CopilotPopup> + the frontend
 * `revise_plan` action have a backend. The chat LLM runs HERE (AnthropicAdapter);
 * the plan logic (`revise_plan` → POST /plans/:id/replan) runs CLIENT-side.
 *
 * Bridge: Fastify has already parsed the application/json body into `req.body`, so
 * we re-serialize it, hand the CopilotKit fetch-style handler a Web `Request`, and
 * stream the Web `Response` back to reply.raw. (@fastify/cors handles the OPTIONS
 * preflight; reply.hijack() bypasses its response hook, so we set the CORS origin
 * header on the actual response ourselves.)
 */

const ENDPOINT = "/v1/copilotkit";
const SKIP_HEADERS = new Set(["content-length", "connection", "transfer-encoding", "host", "keep-alive"]);

export async function copilotkitRoutes(app: FastifyInstance) {
  const runtime = new CopilotRuntime();
  const serviceAdapter = new AnthropicAdapter({
    anthropic: new Anthropic({ apiKey: env.anthropicApiKey || undefined }),
    model: env.copilotModel,
  });
  const handler = copilotRuntimeNodeHttpEndpoint({ endpoint: ENDPOINT, runtime, serviceAdapter });

  app.route({
    method: ["GET", "POST"],
    url: "/copilotkit",
    handler: async (req, reply) => {
      const raw = reply.raw;
      reply.hijack();
      raw.setHeader("Access-Control-Allow-Origin", (req.headers.origin as string | undefined) ?? "*");
      raw.setHeader("Access-Control-Allow-Credentials", "true");

      const host = req.headers.host ?? "localhost";
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (SKIP_HEADERS.has(k.toLowerCase())) continue;
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }

      // Fastify already parsed application/json into req.body — re-serialize it.
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const bodyStr = hasBody && req.body != null ? JSON.stringify(req.body) : undefined;
      if (bodyStr) headers.set("content-type", "application/json");

      const webReq = new Request(`http://${host}${req.raw.url ?? ENDPOINT}`, {
        method: req.method,
        headers,
        body: bodyStr,
      });

      try {
        const response = (await handler(webReq)) as Response;
        raw.statusCode = response.status;
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== "content-length") raw.setHeader(key, value);
        });
        raw.setHeader("Access-Control-Allow-Origin", (req.headers.origin as string | undefined) ?? "*");
        if (response.body) {
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            raw.write(Buffer.from(value));
          }
        }
        raw.end();
      } catch (err) {
        req.log.error({ err }, "copilotkit handler failed");
        if (!raw.headersSent) raw.statusCode = 500;
        raw.end(JSON.stringify({ error: "copilotkit_failed" }));
      }
    },
  });
}

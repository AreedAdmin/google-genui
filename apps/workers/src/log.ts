/**
 * Tiny leveled logger. The workers must never crash the process on a bad job —
 * we log generously and keep going. No external dep; matches LOG_LEVEL semantics
 * from .env.example (debug | info | warn | error).
 */
import { env } from "./env.js";

const order = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof order;

const threshold = order[(env.logLevel as Level)] ?? order.info;

function emit(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (order[level] < threshold) return;
  const ts = new Date().toISOString();
  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const args: unknown[] = extra === undefined ? [line] : [line, extra];
  if (level === "error") console.error(...args);
  else if (level === "warn") console.warn(...args);
  else console.log(...args);
}

export function logger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => emit("debug", scope, msg, extra),
    info: (msg: string, extra?: unknown) => emit("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => emit("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => emit("error", scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof logger>;

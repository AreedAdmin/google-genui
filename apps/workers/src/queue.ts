import { Queue, type ConnectionOptions } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { QUEUES } from "@trellis/shared";
import { env } from "./env.js";

/**
 * BullMQ connection + Queue factory for the worker process.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on the connection it uses for
 * Workers/Queues. We share one connection for outbound enqueues; Workers create
 * their own connection (passed the same options). A separate `createRedis()`
 * yields fresh connections for blocking XADD/XREAD on the run streams.
 */

type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const connectionOptions: ConnectionOptions = {
  // ioredis accepts a URL string via the `url` shorthand isn't part of
  // ConnectionOptions, so we parse it into host/port here defensively while
  // still allowing the full URL through the IORedis ctor in createRedis().
  ...parseRedisUrl(env.redisUrl),
  maxRetriesPerRequest: null,
};

function parseRedisUrl(url: string): { host: string; port: number; password?: string; username?: string } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || "localhost",
      port: u.port ? Number(u.port) : 6379,
      ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
      ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

let sharedConnection: Redis | null = null;
const queues = new Map<QueueName, Queue>();

function connection(): Redis {
  if (!sharedConnection) {
    sharedConnection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  }
  return sharedConnection;
}

/** Get (or lazily create) a BullMQ queue by its canonical name from QUEUES. */
export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: connection() });
    queues.set(name, q);
  }
  return q;
}

/** Fresh ioredis connection (for blocking stream reads / writes). */
export function createRedis(): Redis {
  return new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  if (sharedConnection) {
    sharedConnection.disconnect();
    sharedConnection = null;
  }
  queues.clear();
}

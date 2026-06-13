import { Queue } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { QUEUES } from "@trellis/shared";
import { env } from "./env.js";

/**
 * BullMQ Queue + ioredis connection factory.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on its connection. We keep one
 * shared connection for the queues and expose a separate `createRedis()` for
 * the SSE stream tail (which uses a *blocking* XREAD and must not share a
 * connection with the queues).
 */

type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

let sharedConnection: Redis | null = null;
const queues = new Map<QueueName, Queue>();

function connection(): Redis {
  if (!sharedConnection) {
    sharedConnection = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
    });
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

/**
 * A fresh ioredis connection for blocking reads (SSE stream tail). Each SSE
 * client gets its own so a blocking XREAD never starves others.
 */
export function createRedis(): Redis {
  return new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
}

/** Graceful shutdown helper. */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  if (sharedConnection) {
    sharedConnection.disconnect();
    sharedConnection = null;
  }
  queues.clear();
}

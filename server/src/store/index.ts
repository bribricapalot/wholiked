import { config } from '../config.js';
import type { KV } from './kv.js';
import { MemoryKV } from './memory.js';
import { RedisKV } from './redis.js';

export type { KV } from './kv.js';
export { keys } from './keys.js';

export function createKV(): KV {
  if (config.redisUrl) {
    console.log('[store] using Redis');
    return new RedisKV(config.redisUrl);
  }
  console.log('[store] REDIS_URL not set — using in-memory store (single instance only)');
  return new MemoryKV();
}

/**
 * Minimal ephemeral key-value contract. Implemented by Redis (production) and an
 * in-memory map (dev / single node). Every write takes a TTL — nothing in this
 * app is ever stored without an expiry.
 */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  /** Set only if absent. Returns true when the key was created. */
  setNX(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  expire(key: string, ttlSec: number): Promise<void>;
  hset(key: string, field: string, value: string, ttlSec: number): Promise<void>;
  /** Set only if the field is absent. Returns true when the field was created. */
  hsetNX(key: string, field: string, value: string, ttlSec: number): Promise<boolean>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  hdel(key: string, field: string): Promise<void>;
  close(): Promise<void>;
}

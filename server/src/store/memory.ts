import type { KV } from './kv.js';

type Entry = { value: string | Map<string, string>; expiresAt: number };

/** In-process KV with Redis-like TTL semantics. Data lives only in RAM. */
export class MemoryKV implements KV {
  private data = new Map<string, Entry>();
  private sweeper: NodeJS.Timeout;

  constructor(sweepMs = 60_000) {
    this.sweeper = setInterval(() => this.sweep(), sweepMs);
    this.sweeper.unref();
  }

  private live(key: string): Entry | null {
    const e = this.data.get(key);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
      this.data.delete(key);
      return null;
    }
    return e;
  }

  private sweep() {
    const now = Date.now();
    for (const [k, e] of this.data) if (e.expiresAt <= now) this.data.delete(k);
  }

  private hash(key: string, ttlSec: number): Map<string, string> {
    const e = this.live(key);
    if (e && e.value instanceof Map) {
      e.expiresAt = Date.now() + ttlSec * 1000;
      return e.value;
    }
    const m = new Map<string, string>();
    this.data.set(key, { value: m, expiresAt: Date.now() + ttlSec * 1000 });
    return m;
  }

  async get(key: string) {
    const e = this.live(key);
    return e && typeof e.value === 'string' ? e.value : null;
  }
  async set(key: string, value: string, ttlSec: number) {
    this.data.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }
  async setNX(key: string, value: string, ttlSec: number) {
    if (this.live(key)) return false;
    await this.set(key, value, ttlSec);
    return true;
  }
  async del(...keys: string[]) {
    for (const k of keys) this.data.delete(k);
  }
  async expire(key: string, ttlSec: number) {
    const e = this.live(key);
    if (e) e.expiresAt = Date.now() + ttlSec * 1000;
  }
  async hset(key: string, field: string, value: string, ttlSec: number) {
    this.hash(key, ttlSec).set(field, value);
  }
  async hsetNX(key: string, field: string, value: string, ttlSec: number) {
    const h = this.hash(key, ttlSec);
    if (h.has(field)) return false;
    h.set(field, value);
    return true;
  }
  async hget(key: string, field: string) {
    const e = this.live(key);
    return e && e.value instanceof Map ? (e.value.get(field) ?? null) : null;
  }
  async hgetall(key: string) {
    const e = this.live(key);
    return e && e.value instanceof Map ? Object.fromEntries(e.value) : {};
  }
  async hdel(key: string, field: string) {
    const e = this.live(key);
    if (e && e.value instanceof Map) e.value.delete(field);
  }
  async close() {
    clearInterval(this.sweeper);
    this.data.clear();
  }
}

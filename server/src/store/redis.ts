import { Redis } from 'ioredis';
import type { KV } from './kv.js';

export class RedisKV implements KV {
  private r: Redis;

  constructor(url: string) {
    this.r = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
  }

  async get(key: string) {
    return this.r.get(key);
  }
  async set(key: string, value: string, ttlSec: number) {
    await this.r.set(key, value, 'EX', ttlSec);
  }
  async setNX(key: string, value: string, ttlSec: number) {
    return (await this.r.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
  }
  async del(...keys: string[]) {
    if (keys.length) await this.r.del(...keys);
  }
  async expire(key: string, ttlSec: number) {
    await this.r.expire(key, ttlSec);
  }
  async hset(key: string, field: string, value: string, ttlSec: number) {
    await this.r.multi().hset(key, field, value).expire(key, ttlSec).exec();
  }
  async hsetNX(key: string, field: string, value: string, ttlSec: number) {
    const res = await this.r.multi().hsetnx(key, field, value).expire(key, ttlSec).exec();
    return res?.[0]?.[1] === 1;
  }
  async hget(key: string, field: string) {
    return this.r.hget(key, field);
  }
  async hgetall(key: string) {
    return this.r.hgetall(key);
  }
  async hdel(key: string, field: string) {
    await this.r.hdel(key, field);
  }
  async close() {
    await this.r.quit();
  }
}

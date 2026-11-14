import { Redis } from '@upstash/redis';

/**
 * Storage: Upstash Redis (Vercel Marketplace → "Upstash Redis").
 * Senza variabili d'ambiente usa la memoria del processo (solo per sviluppo locale:
 * su Vercel la memoria NON è condivisa tra le richieste).
 */
const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

type Mem = { kv: Map<string, { v: string; exp?: number }>; lists: Map<string, string[]> };
const g = globalThis as unknown as { __pitstopMem?: Mem };
const mem: Mem = (g.__pitstopMem ??= { kv: new Map(), lists: new Map() });

function parse<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return v as unknown as T;
    }
  }
  return v as T;
}

export const store = {
  kind: (redis ? 'redis' : 'memory') as 'redis' | 'memory',

  async get<T>(key: string): Promise<T | null> {
    if (redis) return parse<T>(await redis.get(key));
    const e = mem.kv.get(key);
    if (!e || (e.exp && e.exp < Date.now())) return null;
    return parse<T>(e.v);
  },

  async set(key: string, value: unknown, exSec?: number): Promise<void> {
    const s = JSON.stringify(value);
    if (redis) {
      await (exSec ? redis.set(key, s, { ex: exSec }) : redis.set(key, s));
      return;
    }
    mem.kv.set(key, { v: s, exp: exSec ? Date.now() + exSec * 1000 : undefined });
  },

  async del(key: string): Promise<void> {
    if (redis) await redis.del(key);
    else mem.kv.delete(key);
  },

  async incr(key: string, exSec?: number): Promise<number> {
    if (redis) {
      const n = await redis.incr(key);
      if (exSec && n === 1) await redis.expire(key, exSec);
      return n;
    }
    const cur = Number(mem.kv.get(key)?.v ?? 0) + 1;
    mem.kv.set(key, { v: String(cur), exp: exSec ? Date.now() + exSec * 1000 : undefined });
    return cur;
  },

  async rpush(key: string, value: string): Promise<void> {
    if (redis) await redis.rpush(key, value);
    else mem.lists.set(key, [...(mem.lists.get(key) ?? []), value]);
  },

  async lpush(key: string, value: string): Promise<void> {
    if (redis) await redis.lpush(key, value);
    else mem.lists.set(key, [value, ...(mem.lists.get(key) ?? [])]);
  },

  async ltrim(key: string, start: number, stop: number): Promise<void> {
    if (redis) await redis.ltrim(key, start, stop);
    else mem.lists.set(key, (mem.lists.get(key) ?? []).slice(start, stop + 1));
  },

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (redis) return ((await redis.lrange(key, start, stop)) as unknown[]).map(String);
    return (mem.lists.get(key) ?? []).slice(start, stop + 1);
  },

  async lrem(key: string, value: string): Promise<void> {
    if (redis) await redis.lrem(key, 0, value);
    else mem.lists.set(key, (mem.lists.get(key) ?? []).filter((x) => x !== value));
  },

  async llen(key: string): Promise<number> {
    if (redis) return await redis.llen(key);
    return (mem.lists.get(key) ?? []).length;
  },
};

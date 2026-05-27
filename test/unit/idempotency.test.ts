import { describe, expect, it, beforeEach } from 'vitest';
import { createIdempotencyCache } from '@shared/cache/idempotency.js';

/**
 * Minimal in-memory Redis stand-in covering the surface used by IdempotencyCache.
 */
function makeFakeRedis() {
  const store = new Map<string, { value: string; expireAt: number | null }>();

  function isExpired(k: string): boolean {
    const v = store.get(k);
    if (!v) return true;
    if (v.expireAt !== null && v.expireAt <= Date.now()) {
      store.delete(k);
      return true;
    }
    return false;
  }

  return {
    async set(
      key: string,
      val: string,
      flag1?: string,
      ttl?: number,
      flag2?: string,
    ): Promise<'OK' | null> {
      const exists = !isExpired(key);
      if (flag2 === 'NX' && exists) {
        return null;
      }
      const expireAt = flag1 === 'EX' && typeof ttl === 'number' ? Date.now() + ttl * 1000 : null;
      store.set(key, { value: val, expireAt });
      return 'OK';
    },
    async get(key: string): Promise<string | null> {
      if (isExpired(key)) return null;
      return store.get(key)?.value ?? null;
    },
    async del(key: string): Promise<number> {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    },
    _store: store,
  };
}

describe('IdempotencyCache', () => {
  let redis: ReturnType<typeof makeFakeRedis>;
  let cache: ReturnType<typeof createIdempotencyCache>;

  beforeEach(() => {
    redis = makeFakeRedis();
    cache = createIdempotencyCache(redis as never, 60);
  });

  it('first reservation is a miss', async () => {
    const r = await cache.checkOrReserve('w1', 'k', { foo: 1 });
    expect(r.status).toBe('miss');
  });

  it('replay with same body and stored response is a hit', async () => {
    await cache.checkOrReserve('w1', 'k', { foo: 1 });
    await cache.storeResponse('w1', 'k', { foo: 1 }, { sendId: 's1', status: 'queued' });
    const r = await cache.checkOrReserve<{ sendId: string; status: string }>('w1', 'k', { foo: 1 });
    expect(r.status).toBe('hit');
    if (r.status === 'hit') {
      expect(r.response).toEqual({ sendId: 's1', status: 'queued' });
    }
  });

  it('replay with different body is a conflict', async () => {
    await cache.checkOrReserve('w1', 'k', { foo: 1 });
    await cache.storeResponse('w1', 'k', { foo: 1 }, { sendId: 's1', status: 'queued' });
    const r = await cache.checkOrReserve('w1', 'k', { foo: 2 });
    expect(r.status).toBe('conflict');
  });

  it('different workspaces with the same key do not collide', async () => {
    const a = await cache.checkOrReserve('w1', 'k', { foo: 1 });
    const b = await cache.checkOrReserve('w2', 'k', { foo: 1 });
    expect(a.status).toBe('miss');
    expect(b.status).toBe('miss');
  });

  it('release removes the entry', async () => {
    await cache.checkOrReserve('w1', 'k', { foo: 1 });
    await cache.release('w1', 'k');
    const after = await cache.checkOrReserve('w1', 'k', { foo: 1 });
    expect(after.status).toBe('miss');
  });

  it('empty key is ignored (treated as miss)', async () => {
    const r = await cache.checkOrReserve('w1', '', { foo: 1 });
    expect(r.status).toBe('miss');
  });
});

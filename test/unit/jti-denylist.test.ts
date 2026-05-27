import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createJtiDenylist } from '@shared/cache/jti-denylist.js';

/**
 * Stand-in Redis. Implements just the API surface used by JtiDenylist.
 */
function makeFakeRedis() {
  const store = new Map<string, { value: string; expireAt: number | null }>();

  const isExpired = (k: string): boolean => {
    const v = store.get(k);
    if (!v) {
      return true;
    }
    if (v.expireAt !== null && v.expireAt <= Date.now()) {
      store.delete(k);
      return true;
    }
    return false;
  };

  const fake = {
    async set(_key: string, _val: string, _flag: 'EX', ttl: number) {
      store.set(_key, { value: _val, expireAt: Date.now() + ttl * 1000 });
      return 'OK';
    },
    async exists(key: string) {
      return isExpired(key) ? 0 : 1;
    },
    pipeline() {
      const ops: Array<() => Promise<unknown>> = [];
      const builder = {
        set(key: string, val: string, flag: 'EX', ttl: number) {
          ops.push(() => fake.set(key, val, flag, ttl));
          return builder;
        },
        async exec() {
          const out: Array<[Error | null, unknown]> = [];
          for (const op of ops) {
            try {
              out.push([null, await op()]);
            } catch (err) {
              out.push([err as Error, null]);
            }
          }
          return out;
        },
      };
      return builder;
    },
    _store: store,
  };
  return fake;
}

describe('JtiDenylist', () => {
  let redis: ReturnType<typeof makeFakeRedis>;
  let denylist: ReturnType<typeof createJtiDenylist>;

  beforeEach(() => {
    redis = makeFakeRedis();
    denylist = createJtiDenylist(redis as unknown as Parameters<typeof createJtiDenylist>[0]);
  });

  it('round-trips a single jti', async () => {
    expect(await denylist.isRevoked('abc')).toBe(false);
    await denylist.revoke('abc', 60);
    expect(await denylist.isRevoked('abc')).toBe(true);
  });

  it('skips empty jti values', async () => {
    await denylist.revoke('', 60);
    expect(redis._store.size).toBe(0);
    expect(await denylist.isRevoked('')).toBe(false);
  });

  it('clamps ttl to a sensible range', async () => {
    await denylist.revoke('z', -100);
    expect(redis._store.get('jtid:z')?.expireAt).toBeGreaterThan(Date.now());

    await denylist.revoke('w', 999_999_999);
    const exp = redis._store.get('jtid:w')?.expireAt ?? 0;
    expect(exp - Date.now()).toBeLessThanOrEqual(60 * 60 * 24 * 7 * 1000);
  });

  it('revokeMany pipelines correctly', async () => {
    await denylist.revokeMany([
      { jti: 'a', ttlSeconds: 30 },
      { jti: 'b', ttlSeconds: 30 },
    ]);
    expect(await denylist.isRevoked('a')).toBe(true);
    expect(await denylist.isRevoked('b')).toBe(true);
    expect(await denylist.isRevoked('c')).toBe(false);
  });

  it('expired entries are not revoked', async () => {
    await denylist.revoke('e', 60);
    const stored = redis._store.get('jtid:e')!;
    stored.expireAt = Date.now() - 1; // simulate expiry
    expect(await denylist.isRevoked('e')).toBe(false);
  });

  // Smoke test: vi.fn isn't used but ensure module surface is intact
  it('module exports are stable', () => {
    expect(typeof denylist.revoke).toBe('function');
    expect(typeof denylist.revokeMany).toBe('function');
    expect(typeof denylist.isRevoked).toBe('function');
    expect(vi).toBeDefined();
  });
});

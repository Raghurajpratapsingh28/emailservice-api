import type { Redis } from 'ioredis';

/**
 * Redis-backed JWT denylist (jti revocation list).
 *
 * On logout / password reset / logout-all we record the access-token `jti`
 * with a TTL equal to its remaining lifetime, so the access token can no
 * longer be used even before its `exp`.
 *
 * Storage: keyspace `jtid:{jti}` with empty value, TTL = remaining seconds.
 */

const PREFIX = 'jtid:';

export interface JtiDenylist {
  /** Revokes a single jti for `ttlSeconds` (clamped to 1..86_400 * 7). */
  revoke(jti: string, ttlSeconds: number): Promise<void>;
  /** Revokes many jtis in one round-trip via pipeline. */
  revokeMany(entries: ReadonlyArray<{ jti: string; ttlSeconds: number }>): Promise<void>;
  /** Returns true if jti is denylisted. */
  isRevoked(jti: string): Promise<boolean>;
}

export function createJtiDenylist(redis: Redis): JtiDenylist {
  const clampTtl = (ttl: number): number => {
    if (!Number.isFinite(ttl) || ttl <= 0) {
      return 1;
    }
    // Cap at 7 days regardless of caller — access tokens should never be longer.
    return Math.min(Math.floor(ttl), 60 * 60 * 24 * 7);
  };

  const key = (jti: string): string => `${PREFIX}${jti}`;

  return {
    async revoke(jti, ttlSeconds) {
      if (!jti) {
        return;
      }
      await redis.set(key(jti), '1', 'EX', clampTtl(ttlSeconds));
    },

    async revokeMany(entries) {
      if (entries.length === 0) {
        return;
      }
      const pipe = redis.pipeline();
      for (const { jti, ttlSeconds } of entries) {
        if (!jti) {
          continue;
        }
        pipe.set(key(jti), '1', 'EX', clampTtl(ttlSeconds));
      }
      await pipe.exec();
    },

    async isRevoked(jti) {
      if (!jti) {
        return false;
      }
      const result = await redis.exists(key(jti));
      return result === 1;
    },
  };
}

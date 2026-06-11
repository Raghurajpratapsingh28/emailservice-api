import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Redis } from 'ioredis';
import { TooManyRequestsError } from '@shared/errors/app-errors.js';

/**
 * Redis-backed sliding-window rate limiter with multiple keys per request.
 *
 * Hardening (F4 — single-axis limiter is bypassable):
 *   We always limit by IP, AND additionally by email/user where applicable.
 *   This neutralises:
 *     - Distributed brute force (rotating IPs vs same email)
 *     - One-IP many-accounts spraying (which the IP limit alone catches)
 *
 * Algorithm: simple fixed-window counter using INCR + EXPIRE. Good enough at
 * the scale we operate; if we need precise sliding windows later, swap to
 * RedisCell or a Lua sliding-window script.
 *
 * Keys are namespaced under `rl:{bucket}:{key}` so different buckets don't
 * interfere.
 */

export interface RateLimitRule {
  bucket: string;
  /** Function deriving keys from the request. Each key is independently checked. */
  keys: (req: FastifyRequest) => string[];
  /** Allowed requests in the window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** When true, reject requests if Redis is unreachable rather than allowing through. Use for auth-critical endpoints. */
  failClosed?: boolean;
}

export function createRateLimitMiddleware(
  redis: Redis,
  rule: RateLimitRule,
): preHandlerHookHandler {
  const { bucket, keys, max, windowSeconds, failClosed = false } = rule;

  return async function rateLimit(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const derived = keys(req).filter((k): k is string => typeof k === 'string' && k.length > 0);
    if (derived.length === 0) {
      return;
    }

    const pipe = redis.pipeline();
    for (const key of derived) {
      const redisKey = `rl:${bucket}:${key}`;
      pipe.incr(redisKey);
      pipe.expire(redisKey, windowSeconds, 'NX');
    }
    const results = await pipe.exec();
    if (!results) {
      if (failClosed) {
        req.log.error({ bucket }, '[rate-limit] redis unreachable — rejecting request (fail-closed)');
        throw new TooManyRequestsError('Rate limiter unavailable');
      }
      req.log.warn({ bucket }, '[rate-limit] redis pipeline empty');
      return;
    }

    let exceededKey: string | undefined;
    let highest = 0;
    for (let i = 0; i < derived.length; i++) {
      const incrResult = results[i * 2];
      if (!incrResult) {
        continue;
      }
      const [err, value] = incrResult;
      if (err) {
        req.log.warn({ err, bucket }, '[rate-limit] incr failed');
        continue;
      }
      const count = typeof value === 'number' ? value : Number(value);
      if (count > highest) {
        highest = count;
      }
      if (count > max && !exceededKey) {
        exceededKey = derived[i];
      }
    }

    void reply.header('x-ratelimit-bucket', bucket);
    void reply.header('x-ratelimit-limit', String(max));
    void reply.header('x-ratelimit-remaining', String(Math.max(0, max - highest)));

    if (exceededKey) {
      void reply.header('retry-after', String(windowSeconds));
      throw new TooManyRequestsError('Rate limit exceeded');
    }
  };
}

/**
 * Factory of common rule sets used across auth routes. Tune via config.
 */
export const AuthRateLimitRules = {
  // Login: per-IP and per-email. Aggressive defaults — adjust per business.
  login(redis: Redis, opts: { perIpMax: number; perEmailMax: number; windowSeconds: number }) {
    return [
      createRateLimitMiddleware(redis, {
        bucket: 'login:ip',
        keys: (req) => [req.ip],
        max: opts.perIpMax,
        windowSeconds: opts.windowSeconds,
        failClosed: true,
      }),
      createRateLimitMiddleware(redis, {
        bucket: 'login:email',
        keys: (req) => {
          const body = req.body as { email?: unknown } | undefined;
          const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
          return email ? [email] : [];
        },
        max: opts.perEmailMax,
        windowSeconds: opts.windowSeconds,
        failClosed: true,
      }),
    ];
  },

  forgotPassword(redis: Redis, opts: { perIpMax: number; perEmailMax: number; windowSeconds: number }) {
    return [
      createRateLimitMiddleware(redis, {
        bucket: 'forgot:ip',
        keys: (req) => [req.ip],
        max: opts.perIpMax,
        windowSeconds: opts.windowSeconds,
        failClosed: true,
      }),
      createRateLimitMiddleware(redis, {
        bucket: 'forgot:email',
        keys: (req) => {
          const body = req.body as { email?: unknown } | undefined;
          const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
          return email ? [email] : [];
        },
        max: opts.perEmailMax,
        windowSeconds: opts.windowSeconds,
        failClosed: true,
      }),
    ];
  },

  signup(redis: Redis, opts: { perIpMax: number; windowSeconds: number }) {
    return [
      createRateLimitMiddleware(redis, {
        bucket: 'signup:ip',
        keys: (req) => [req.ip],
        max: opts.perIpMax,
        windowSeconds: opts.windowSeconds,
      }),
    ];
  },

  refresh(redis: Redis, opts: { perIpMax: number; windowSeconds: number }) {
    return [
      createRateLimitMiddleware(redis, {
        bucket: 'refresh:ip',
        keys: (req) => [req.ip],
        max: opts.perIpMax,
        windowSeconds: opts.windowSeconds,
      }),
    ];
  },

  changePassword(redis: Redis, opts: { perUserMax: number; windowSeconds: number }) {
    return [
      createRateLimitMiddleware(redis, {
        bucket: 'change-password:user',
        keys: (req) => {
          const userId = (req as FastifyRequest & { authedUser?: { id: string } }).authedUser?.id;
          return userId ? [userId] : [];
        },
        max: opts.perUserMax,
        windowSeconds: opts.windowSeconds,
        failClosed: true,
      }),
    ];
  },
};

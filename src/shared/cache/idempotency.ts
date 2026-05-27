import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Per-workspace idempotency cache backed by Redis.
 *
 * Use case:
 *   - Caller passes `idempotencyKey` on POST /emails/send.
 *   - On first hit, we atomically reserve the key (24h TTL) and remember the
 *     response payload so retries return the *same* sendId/status without
 *     re-queuing.
 *   - We hash both the key and the request body. If the same `idempotencyKey`
 *     arrives with a *different* body, we treat that as a key conflict so a
 *     careless client doesn't get a stale reply.
 *
 * Key layout: `idempotency:{workspaceId}:{key}` → `{ bodyHash, response }` JSON
 */

const PREFIX = 'idempotency:';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24; // 24h

export interface IdempotencyHit<T> {
  status: 'hit';
  response: T;
}

export interface IdempotencyMiss {
  status: 'miss';
}

export interface IdempotencyConflict {
  status: 'conflict';
}

export type IdempotencyLookupResult<T> = IdempotencyHit<T> | IdempotencyMiss | IdempotencyConflict;

export interface IdempotencyCache {
  /**
   * Atomically reserves the key and stores the response payload.
   * Returns:
   *   - `miss`     — first time, caller should proceed
   *   - `hit`      — replay; caller should return the stored response
   *   - `conflict` — same key, different body — return 409 IDEMPOTENT_REPLAY
   */
  checkOrReserve<T>(
    workspaceId: string,
    key: string,
    bodyForHashing: unknown,
  ): Promise<IdempotencyLookupResult<T>>;

  /** Persists the actual response under the reserved key. */
  storeResponse<T>(
    workspaceId: string,
    key: string,
    bodyForHashing: unknown,
    response: T,
    ttlSeconds?: number,
  ): Promise<void>;

  /** Removes the entry — for tests and explicit invalidation. */
  release(workspaceId: string, key: string): Promise<void>;
}

interface CacheRecord<T> {
  bodyHash: string;
  response: T | null;
}

function redisKey(workspaceId: string, key: string): string {
  return `${PREFIX}${workspaceId}:${key}`;
}

function hashBody(body: unknown): string {
  // JSON.stringify is stable enough for our use; if the client sends keys in
  // a different order we'll see a "conflict" — that's actually the right call:
  // tell the caller to use a fresh idempotency key.
  const json = JSON.stringify(body ?? null);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

export function createIdempotencyCache(
  redis: Redis,
  defaultTtlSeconds = DEFAULT_TTL_SECONDS,
): IdempotencyCache {
  return {
    async checkOrReserve<T>(
      workspaceId: string,
      key: string,
      bodyForHashing: unknown,
    ): Promise<IdempotencyLookupResult<T>> {
      if (!key) {
        return { status: 'miss' };
      }
      const k = redisKey(workspaceId, key);
      const bodyHash = hashBody(bodyForHashing);

      // Reserve atomically. NX so we only win if the key didn't exist.
      const placeholder: CacheRecord<null> = { bodyHash, response: null };
      const reserved = await redis.set(
        k,
        JSON.stringify(placeholder),
        'EX',
        defaultTtlSeconds,
        'NX',
      );

      if (reserved === 'OK') {
        return { status: 'miss' };
      }

      // Existing entry — read it.
      const existingRaw = await redis.get(k);
      if (!existingRaw) {
        return { status: 'miss' };
      }
      try {
        const existing = JSON.parse(existingRaw) as CacheRecord<T>;
        if (existing.bodyHash !== bodyHash) {
          return { status: 'conflict' };
        }
        return { status: 'hit', response: existing.response as T };
      } catch {
        await redis.set(k, JSON.stringify({ bodyHash, response: null }), 'EX', defaultTtlSeconds);
        return { status: 'miss' };
      }
    },

    async storeResponse<T>(
      workspaceId: string,
      key: string,
      bodyForHashing: unknown,
      response: T,
      ttlSeconds?: number,
    ): Promise<void> {
      if (!key) {
        return;
      }
      const k = redisKey(workspaceId, key);
      const record: CacheRecord<T> = {
        bodyHash: hashBody(bodyForHashing),
        response,
      };
      await redis.set(k, JSON.stringify(record), 'EX', ttlSeconds ?? defaultTtlSeconds);
    },

    async release(workspaceId: string, key: string): Promise<void> {
      if (!key) {
        return;
      }
      await redis.del(redisKey(workspaceId, key)).catch(() => undefined);
    },
  };
}

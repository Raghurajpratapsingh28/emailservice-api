import { and, eq, inArray } from 'drizzle-orm';
import {
  permissions as permissionsTable,
  rolePermissions,
  roles,
  workspaceMembers,
} from '@shared/database/schema/index.js';
import type { Database } from '@shared/database/client.js';
import type { Redis } from '@shared/cache/client.js';
import type { Permission, RoleSlug } from '@constants/rbac.js';

/**
 * Resolves and caches a user's effective role + permissions inside a workspace.
 *
 * Cache key: `rbac:{workspaceId}:{userId}` → JSON { role, permissions }.
 * TTL: 60s.
 *
 * Hardening over the previous version (F6 — multi-replica RBAC cache lag):
 *   The previous service called `del()` on the local replica only. With N
 *   replicas, demoting a member could leave them with their old permissions
 *   on N-1 replicas for up to 60s.
 *
 *   New behaviour:
 *     - On any role/membership mutation, we publish a message on the Redis
 *       pub/sub channel `rbac:invalidate`.
 *     - Each replica subscribes during construction and removes the matching
 *       cache key from its local Redis (Redis is shared, so a single DEL is
 *       enough — but the publish doubles as a "you've been kicked" signal
 *       for any in-process LRU we may add later).
 */

const CACHE_TTL_SECONDS = 60;
const INVALIDATE_CHANNEL = 'rbac:invalidate';

export interface MembershipContext {
  membershipId: string;
  role: RoleSlug;
  permissions: Set<Permission>;
}

interface InvalidateMessage {
  scope: 'pair' | 'workspace' | 'all';
  workspaceId?: string;
  userId?: string;
}

export class RbacService {
  /** Subscriber connection (separate from main Redis). Created lazily. */
  private subscriber?: Redis;

  public constructor(
    private readonly db: Database,
    private readonly redis: Redis,
  ) {}

  /**
   * Subscribes to the pub/sub channel. Must be called once per process at
   * startup. The subscriber Redis is a duplicate connection (ioredis requires
   * a dedicated subscriber).
   */
  public async startInvalidationListener(subscriber: Redis): Promise<void> {
    this.subscriber = subscriber;
    await subscriber.subscribe(INVALIDATE_CHANNEL);
    subscriber.on('message', (channel, message) => {
      if (channel !== INVALIDATE_CHANNEL) {
        return;
      }
      try {
        const msg = JSON.parse(message) as InvalidateMessage;
        if (msg.scope === 'pair' && msg.workspaceId && msg.userId) {
          void this.redis.del(this.cacheKey(msg.workspaceId, msg.userId)).catch(() => undefined);
        } else if (msg.scope === 'workspace' && msg.workspaceId) {
          void this.invalidateWorkspaceLocal(msg.workspaceId);
        } else if (msg.scope === 'all') {
          void this.flushAllLocal();
        }
      } catch {
        // ignore malformed messages
      }
    });
  }

  public async stopInvalidationListener(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(INVALIDATE_CHANNEL).catch(() => undefined);
    }
  }

  public async getMembershipContext(
    workspaceId: string,
    userId: string,
  ): Promise<MembershipContext | null> {
    const cacheKey = this.cacheKey(workspaceId, userId);

    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          membershipId: string;
          role: RoleSlug;
          permissions: Permission[];
        };
        return {
          membershipId: parsed.membershipId,
          role: parsed.role,
          permissions: new Set(parsed.permissions),
        };
      } catch {
        // fall through to fresh load
      }
    }

    const membership = await this.db
      .select({
        membershipId: workspaceMembers.id,
        roleId: workspaceMembers.roleId,
        roleSlug: roles.slug,
      })
      .from(workspaceMembers)
      .innerJoin(roles, eq(roles.id, workspaceMembers.roleId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);

    const m = membership[0];
    if (!m) {
      return null;
    }

    const perms = await this.db
      .select({ slug: permissionsTable.slug })
      .from(rolePermissions)
      .innerJoin(permissionsTable, eq(permissionsTable.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, m.roleId));

    const permissionSlugs = perms.map((p) => p.slug as Permission);
    const role = m.roleSlug as RoleSlug;

    await this.redis
      .set(
        cacheKey,
        JSON.stringify({
          membershipId: m.membershipId,
          role,
          permissions: permissionSlugs,
        }),
        'EX',
        CACHE_TTL_SECONDS,
      )
      .catch(() => undefined);

    return {
      membershipId: m.membershipId,
      role,
      permissions: new Set(permissionSlugs),
    };
  }

  public hasAllPermissions(
    membership: MembershipContext,
    required: readonly Permission[],
  ): boolean {
    return required.every((p) => membership.permissions.has(p));
  }

  public missingPermissions(
    membership: MembershipContext,
    required: readonly Permission[],
  ): Permission[] {
    return required.filter((p) => !membership.permissions.has(p));
  }

  public async resolveRoleId(slug: RoleSlug): Promise<string> {
    const rows = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.slug, slug))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new Error(`Role '${slug}' not found — has the seed been run?`);
    }
    return row.id;
  }

  public async resolveRoleIds(slugs: readonly RoleSlug[]): Promise<Map<RoleSlug, string>> {
    if (slugs.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ id: roles.id, slug: roles.slug })
      .from(roles)
      .where(inArray(roles.slug, [...slugs]));
    return new Map(rows.map((r) => [r.slug as RoleSlug, r.id]));
  }

  /**
   * Invalidate (workspace, user) pair across all replicas.
   * Local DEL + publish.
   */
  public async invalidate(workspaceId: string, userId: string): Promise<void> {
    await this.redis.del(this.cacheKey(workspaceId, userId)).catch(() => undefined);
    await this.publishInvalidate({ scope: 'pair', workspaceId, userId });
  }

  /** Invalidate every member of a workspace across all replicas. */
  public async invalidateWorkspace(workspaceId: string): Promise<void> {
    await this.invalidateWorkspaceLocal(workspaceId);
    await this.publishInvalidate({ scope: 'workspace', workspaceId });
  }

  /** Invalidate every member of every workspace (e.g. after permissions seed change). */
  public async invalidateAll(): Promise<void> {
    await this.flushAllLocal();
    await this.publishInvalidate({ scope: 'all' });
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private cacheKey(workspaceId: string, userId: string): string {
    return `rbac:${workspaceId}:${userId}`;
  }

  private async invalidateWorkspaceLocal(workspaceId: string): Promise<void> {
    const members = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId));

    if (members.length === 0) {
      return;
    }
    const keys = members.map((m) => this.cacheKey(workspaceId, m.userId));
    await this.redis.del(...keys).catch(() => undefined);
  }

  private async flushAllLocal(): Promise<void> {
    // Use SCAN to avoid KEYS * blocking. Limit to our prefix.
    const stream = this.redis.scanStream({ match: 'rbac:*', count: 500 });
    for await (const batch of stream as unknown as AsyncIterable<string[]>) {
      if (batch.length > 0) {
        await this.redis.del(...batch).catch(() => undefined);
      }
    }
  }

  private async publishInvalidate(msg: InvalidateMessage): Promise<void> {
    try {
      await this.redis.publish(INVALIDATE_CHANNEL, JSON.stringify(msg));
    } catch {
      // noop — local DEL has already happened
    }
  }
}

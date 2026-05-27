import { and, asc, count, desc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import {
  roles,
  users,
  workspaceMembers,
  workspaceSettings,
  workspaces,
  type NewWorkspace,
  type NewWorkspaceSettings,
  type Workspace,
  type WorkspaceSettings,
} from '@shared/database/schema/index.js';
import type { Database } from '@shared/database/client.js';
import type { RoleSlug } from '@constants/rbac.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface ListMembersFilter {
  workspaceId: string;
  search?: string;
  roleSlug?: RoleSlug;
  page: number;
  pageSize: number;
}

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  roleSlug: RoleSlug;
  invitedByUserId: string | null;
  joinedAt: Date;
}

export interface MembershipDetail {
  membershipId: string;
  userId: string;
  workspaceId: string;
  roleId: string;
  roleSlug: RoleSlug;
}

/**
 * Workspace data-access layer. All queries that touch workspace-scoped tables
 * must filter by `workspaceId` — there is no method that returns a row without
 * such a filter, by design.
 */
export class WorkspaceRepository {
  public constructor(private readonly db: Database) {}

  // ─── Workspace CRUD ───────────────────────────────────────────────────────

  public async insertWorkspace(
    tx: Tx | Database,
    values: NewWorkspace,
  ): Promise<Workspace> {
    const rows = await tx.insert(workspaces).values(values).returning();
    return rows[0]!;
  }

  public async findById(workspaceId: string, includeDeleted = false): Promise<Workspace | null> {
    const cond = includeDeleted
      ? eq(workspaces.id, workspaceId)
      : and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt));
    const rows = await this.db.select().from(workspaces).where(cond).limit(1);
    return rows[0] ?? null;
  }

  public async findBySlug(slug: string): Promise<Workspace | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  public async slugExists(tx: Tx | Database, slug: string): Promise<boolean> {
    const rows = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Conditional update with optimistic concurrency.
   * Returns null if no row matched (workspace gone, soft-deleted, or version mismatch).
   */
  public async updateWithVersion(
    workspaceId: string,
    expectedVersion: number,
    patch: Partial<Pick<Workspace, 'name' | 'slug' | 'plan' | 'status' | 'metadata' | 'ownerUserId' | 'deletedAt'>>,
  ): Promise<Workspace | null> {
    const rows = await this.db
      .update(workspaces)
      .set({
        ...patch,
        version: sql`${workspaces.version} + 1`,
      })
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.version, expectedVersion),
          isNull(workspaces.deletedAt),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  public async softDelete(workspaceId: string): Promise<Workspace | null> {
    const rows = await this.db
      .update(workspaces)
      .set({
        status: 'deleted',
        deletedAt: new Date(),
        version: sql`${workspaces.version} + 1`,
      })
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .returning();
    return rows[0] ?? null;
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  public async findSettings(workspaceId: string): Promise<WorkspaceSettings | null> {
    const rows = await this.db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId))
      .limit(1);
    return rows[0] ?? null;
  }

  public async insertSettings(
    tx: Tx | Database,
    values: NewWorkspaceSettings,
  ): Promise<WorkspaceSettings> {
    const rows = await tx.insert(workspaceSettings).values(values).returning();
    return rows[0]!;
  }

  public async upsertSettings(
    workspaceId: string,
    patch: Partial<NewWorkspaceSettings>,
  ): Promise<WorkspaceSettings> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(workspaceSettings)
        .where(eq(workspaceSettings.workspaceId, workspaceId))
        .limit(1)
        .for('update');

      if (existing.length === 0) {
        const inserted = await tx
          .insert(workspaceSettings)
          .values({ workspaceId, ...patch })
          .returning();
        return inserted[0]!;
      }

      const updated = await tx
        .update(workspaceSettings)
        .set(patch)
        .where(eq(workspaceSettings.workspaceId, workspaceId))
        .returning();
      return updated[0]!;
    });
  }

  // ─── Memberships ──────────────────────────────────────────────────────────

  public async findMembership(
    workspaceId: string,
    userId: string,
  ): Promise<MembershipDetail | null> {
    const rows = await this.db
      .select({
        membershipId: workspaceMembers.id,
        userId: workspaceMembers.userId,
        workspaceId: workspaceMembers.workspaceId,
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
    const r = rows[0];
    return r
      ? {
          membershipId: r.membershipId,
          userId: r.userId,
          workspaceId: r.workspaceId,
          roleId: r.roleId,
          roleSlug: r.roleSlug as RoleSlug,
        }
      : null;
  }

  public async findMembershipById(
    workspaceId: string,
    membershipId: string,
  ): Promise<MembershipDetail | null> {
    const rows = await this.db
      .select({
        membershipId: workspaceMembers.id,
        userId: workspaceMembers.userId,
        workspaceId: workspaceMembers.workspaceId,
        roleId: workspaceMembers.roleId,
        roleSlug: roles.slug,
      })
      .from(workspaceMembers)
      .innerJoin(roles, eq(roles.id, workspaceMembers.roleId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.id, membershipId),
        ),
      )
      .limit(1);
    const r = rows[0];
    return r
      ? {
          membershipId: r.membershipId,
          userId: r.userId,
          workspaceId: r.workspaceId,
          roleId: r.roleId,
          roleSlug: r.roleSlug as RoleSlug,
        }
      : null;
  }

  public async insertMembership(
    tx: Tx | Database,
    values: { workspaceId: string; userId: string; roleId: string; invitedBy?: string | null },
  ): Promise<{ id: string }> {
    const rows = await tx
      .insert(workspaceMembers)
      .values({
        workspaceId: values.workspaceId,
        userId: values.userId,
        roleId: values.roleId,
        invitedBy: values.invitedBy ?? null,
      })
      .returning({ id: workspaceMembers.id });
    return rows[0]!;
  }

  public async updateMembershipRole(
    tx: Tx | Database,
    membershipId: string,
    roleId: string,
  ): Promise<void> {
    await tx
      .update(workspaceMembers)
      .set({ roleId, updatedAt: new Date() })
      .where(eq(workspaceMembers.id, membershipId));
  }

  public async deleteMembership(
    tx: Tx | Database,
    workspaceId: string,
    membershipId: string,
  ): Promise<{ id: string } | null> {
    const rows = await tx
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.id, membershipId),
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
      )
      .returning({ id: workspaceMembers.id });
    return rows[0] ?? null;
  }

  public async countOwners(tx: Tx | Database, workspaceId: string, excludeUserId?: string): Promise<number> {
    const conds = [
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(roles.slug, 'owner'),
    ];
    if (excludeUserId) {
      conds.push(ne(workspaceMembers.userId, excludeUserId));
    }
    const rows = await tx
      .select({ c: count() })
      .from(workspaceMembers)
      .innerJoin(roles, eq(roles.id, workspaceMembers.roleId))
      .where(and(...conds));
    return Number(rows[0]?.c ?? 0);
  }

  public async listMembers(filter: ListMembersFilter): Promise<{ items: MemberRow[]; total: number }> {
    const conds = [eq(workspaceMembers.workspaceId, filter.workspaceId)];

    if (filter.search && filter.search.length > 0) {
      const term = `%${filter.search}%`;
      conds.push(
        or(
          ilike(users.email, term),
          ilike(users.firstName, term),
          ilike(users.lastName, term),
        )!,
      );
    }
    if (filter.roleSlug) {
      conds.push(eq(roles.slug, filter.roleSlug));
    }

    const offset = (filter.page - 1) * filter.pageSize;

    const itemsP = this.db
      .select({
        membershipId: workspaceMembers.id,
        userId: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        isActive: users.isActive,
        roleSlug: roles.slug,
        invitedByUserId: workspaceMembers.invitedBy,
        joinedAt: workspaceMembers.joinedAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .innerJoin(roles, eq(roles.id, workspaceMembers.roleId))
      .where(and(...conds))
      .orderBy(desc(workspaceMembers.joinedAt), asc(users.email))
      .limit(filter.pageSize)
      .offset(offset);

    const totalP = this.db
      .select({ c: count() })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .innerJoin(roles, eq(roles.id, workspaceMembers.roleId))
      .where(and(...conds));

    const [items, totalRows] = await Promise.all([itemsP, totalP]);
    return {
      items: items.map((i) => ({
        membershipId: i.membershipId,
        userId: i.userId,
        email: i.email,
        firstName: i.firstName,
        lastName: i.lastName,
        isActive: i.isActive,
        roleSlug: i.roleSlug as RoleSlug,
        invitedByUserId: i.invitedByUserId,
        joinedAt: i.joinedAt,
      })),
      total: Number(totalRows[0]?.c ?? 0),
    };
  }

  // ─── Listing user's workspaces ───────────────────────────────────────────

  public async listUserWorkspaces(userId: string): Promise<
    Array<Workspace & { role: RoleSlug; joinedAt: Date }>
  > {
    const rows = await this.db
      .select({
        workspace: workspaces,
        roleSlug: roles.slug,
        joinedAt: workspaceMembers.joinedAt,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .innerJoin(roles, eq(roles.id, workspaceMembers.roleId))
      .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
      .orderBy(desc(workspaceMembers.joinedAt))
      .limit(100);

    return rows.map((r) => ({
      ...r.workspace,
      role: r.roleSlug as RoleSlug,
      joinedAt: r.joinedAt,
    }));
  }
}

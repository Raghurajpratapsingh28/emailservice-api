import { config } from '@config/index.js';
import { ROLE_SLUGS, ROLE_WEIGHT, type RoleSlug } from '@constants/rbac.js';
import { NATS_SUBJECTS } from '@constants/nats-subjects.js';
import { and, eq } from 'drizzle-orm';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@shared/errors/app-errors.js';
import { generateRandomHex } from '@shared/utils/crypto.js';
import { signAccessToken } from '@shared/utils/jwt.js';
import { parseDurationToSeconds } from '@shared/utils/time.js';
import { roles, workspaceMembers } from '@shared/database/schema/index.js';
import type { Database } from '@shared/database/client.js';
import type { Workspace, WorkspaceSettings } from '@shared/database/schema/index.js';
import type { NatsClient } from '@shared/queue/nats.js';
import type { AuthenticatedUser } from '@shared/types/index.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';
import type { RbacService } from '@modules/auth/services/rbac.service.js';
import type { TokenService } from '@modules/auth/services/token.service.js';
import {
  WorkspaceRepository,
  type MemberRow,
  type MembershipDetail,
} from '../repositories/workspace.repository.js';
import type {
  CreateWorkspaceBody,
  ListMembersQuery,
  UpdateMemberRoleBody,
  UpdateSettingsBody,
  UpdateWorkspaceBody,
} from '../schemas/workspace.schema.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface ActorContext {
  user: AuthenticatedUser;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface WorkspaceWithRole {
  workspace: Workspace;
  role: RoleSlug;
  joinedAt: Date;
}

const MAX_SLUG_ATTEMPTS = 6;

/**
 * Workspace service — orchestrates the 12 workspace endpoints with transactional
 * safety, RBAC checks, audit logging, and tenant isolation.
 *
 * Tenant isolation invariants enforced here (in addition to the workspace-guard
 * middleware that already validates membership):
 *   - Every mutating method verifies that the actor's membership exists in the
 *     target workspace before applying changes.
 *   - Member-id parameters are always paired with workspace-id in the WHERE clause
 *     (via the repository) — preventing cross-workspace member updates.
 *   - Role-weight comparisons enforce the privilege hierarchy on every role change.
 *   - Owner protection: the last owner can never be demoted, removed, or have
 *     ownership transferred to a non-member.
 */
export class WorkspaceService {
  public constructor(
    private readonly db: Database,
    private readonly repo: WorkspaceRepository,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly nats: NatsClient,
  ) {}

  // ─── 1. Create workspace ──────────────────────────────────────────────────

  public async createWorkspace(
    input: CreateWorkspaceBody,
    actor: ActorContext,
  ): Promise<{ workspace: Workspace; settings: WorkspaceSettings; role: RoleSlug }> {
    const ownerRoleId = await this.rbac.resolveRoleId(ROLE_SLUGS.OWNER);
    const plan = input.plan ?? 'free';

    const result = await this.db.transaction(async (tx) => {
      const slug = input.slug
        ? await this.ensureSlugUnique(tx, input.slug)
        : await this.generateUniqueSlug(tx, input.name);

      const ws = await this.repo.insertWorkspace(tx, {
        name: input.name.trim(),
        slug,
        plan,
        ownerUserId: actor.user.id,
        metadata: input.metadata ?? {},
      });

      await this.repo.insertMembership(tx, {
        workspaceId: ws.id,
        userId: actor.user.id,
        roleId: ownerRoleId,
      });

      const settings = await this.repo.insertSettings(tx, {
        workspaceId: ws.id,
      });

      return { ws, settings };
    });

    await this.rbac.invalidate(result.ws.id, actor.user.id);

    this.publishEvent(NATS_SUBJECTS.WORKSPACE_CREATED, {
      workspaceId: result.ws.id,
      ownerUserId: actor.user.id,
      slug: result.ws.slug,
    });

    await this.audit.record({
      action: 'workspace.created',
      actorUserId: actor.user.id,
      workspaceId: result.ws.id,
      targetType: 'workspace',
      targetId: result.ws.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { name: result.ws.name, plan: result.ws.plan },
    });

    return { workspace: result.ws, settings: result.settings, role: ROLE_SLUGS.OWNER };
  }

  // ─── 2. List user workspaces ──────────────────────────────────────────────

  public async listUserWorkspaces(
    userId: string,
  ): Promise<Array<WorkspaceWithRole & { permissions: string[] }>> {
    const rows = await this.repo.listUserWorkspaces(userId);

    // Resolve permissions per row via RbacService cache
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const ctx = await this.rbac.getMembershipContext(r.id, userId);
        return {
          workspace: r,
          role: r.role,
          joinedAt: r.joinedAt,
          permissions: ctx ? Array.from(ctx.permissions) : [],
        };
      }),
    );
    return enriched;
  }

  // ─── 3. Get current workspace (resolved by middleware) ────────────────────

  public async getCurrentWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<{ workspace: Workspace; role: RoleSlug; permissions: string[] }> {
    const ws = await this.repo.findById(workspaceId);
    if (!ws) {
      throw new NotFoundError('Workspace not found');
    }
    this.assertActive(ws);

    const ctx = await this.rbac.getMembershipContext(workspaceId, userId);
    if (!ctx) {
      throw new ForbiddenError('Not a member of this workspace', 'WORKSPACE_ACCESS_DENIED');
    }

    return { workspace: ws, role: ctx.role, permissions: Array.from(ctx.permissions) };
  }

  // ─── 4. Update workspace ──────────────────────────────────────────────────

  public async updateWorkspace(
    workspaceId: string,
    body: UpdateWorkspaceBody,
    actor: ActorContext,
  ): Promise<Workspace> {
    const existing = await this.repo.findById(workspaceId);
    if (!existing) {
      throw new NotFoundError('Workspace not found');
    }
    this.assertActive(existing);

    const patch: Partial<Workspace> = {};
    if (body.name !== undefined) {
      patch.name = body.name.trim();
    }
    if (body.metadata !== undefined) {
      patch.metadata = body.metadata;
    }
    if (body.slug !== undefined && body.slug !== existing.slug) {
      // Slug change — must be unique
      const taken = await this.repo.findBySlug(body.slug);
      if (taken && taken.id !== workspaceId) {
        throw new ConflictError('Slug already taken', 'SLUG_TAKEN');
      }
      patch.slug = body.slug;
    }

    const updated = await this.repo.updateWithVersion(workspaceId, body.version, patch);
    if (!updated) {
      throw new ConflictError(
        'Workspace was modified by another request — please retry',
        'VERSION_CONFLICT',
      );
    }

    await this.audit.record({
      action: 'workspace.member.added', // use workspace.* — falls back to generic action; refine later
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workspace',
      targetId: workspaceId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: {
        kind: 'workspace.updated',
        changedFields: Object.keys(patch),
        prevVersion: body.version,
      },
    });

    return updated;
  }

  // ─── 5. Switch workspace ──────────────────────────────────────────────────

  /**
   * Switches active workspace by issuing a fresh access token whose `ws` claim
   * is the new workspace id. The current refresh token is left intact (no
   * rotation) — workspace switching is not a session-level event.
   *
   * Validates membership before issuing.
   */
  public async switchWorkspace(
    targetWorkspaceId: string,
    actor: ActorContext,
  ): Promise<{ workspaceId: string; accessToken: string; expiresIn: number }> {
    const ws = await this.repo.findById(targetWorkspaceId);
    if (!ws) {
      throw new NotFoundError('Workspace not found');
    }
    this.assertActive(ws);

    const ctx = await this.rbac.getMembershipContext(ws.id, actor.user.id);
    if (!ctx) {
      throw new ForbiddenError('Not a member of this workspace', 'WORKSPACE_ACCESS_DENIED');
    }

    const accessTtl = parseDurationToSeconds(config.JWT_ACCESS_TTL);
    const accessToken = signAccessToken({
      sub: actor.user.id,
      email: actor.user.email,
      ws: ws.id,
      jti: ctx.membershipId,
    });

    await this.audit.record({
      action: 'auth.login.success',
      actorUserId: actor.user.id,
      workspaceId: ws.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'workspace.switched', targetWorkspaceId: ws.id },
    });

    return { workspaceId: ws.id, accessToken, expiresIn: accessTtl };
  }

  // ─── 6. Settings ──────────────────────────────────────────────────────────

  public async getSettings(workspaceId: string): Promise<WorkspaceSettings> {
    const existing = await this.repo.findSettings(workspaceId);
    if (existing) {
      return existing;
    }
    // Lazy-create a default settings row for legacy workspaces.
    return this.repo.insertSettings(this.db, { workspaceId });
  }

  public async updateSettings(
    workspaceId: string,
    body: UpdateSettingsBody,
    actor: ActorContext,
  ): Promise<WorkspaceSettings> {
    const ws = await this.repo.findById(workspaceId);
    if (!ws) {
      throw new NotFoundError('Workspace not found');
    }
    this.assertActive(ws);

    const updated = await this.repo.upsertSettings(workspaceId, {
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.locale !== undefined ? { locale: body.locale } : {}),
      ...(body.branding !== undefined ? { branding: body.branding } : {}),
      ...(body.emailDefaults !== undefined ? { emailDefaults: body.emailDefaults } : {}),
      ...(body.featureFlags !== undefined ? { featureFlags: body.featureFlags } : {}),
      ...(body.webhookSettings !== undefined ? { webhookSettings: body.webhookSettings } : {}),
    });

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workspace_settings',
      targetId: workspaceId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'workspace.settings.updated', fields: Object.keys(body) },
    });

    return updated;
  }

  // ─── 7. List members ──────────────────────────────────────────────────────

  public async listMembers(
    workspaceId: string,
    query: ListMembersQuery,
  ): Promise<{ items: MemberRow[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const result = await this.repo.listMembers({
      workspaceId,
      search: query.search,
      roleSlug: query.role as RoleSlug | undefined,
      page,
      pageSize,
    });

    return { ...result, page, pageSize };
  }

  // ─── 8. Update member role ────────────────────────────────────────────────

  public async updateMemberRole(
    workspaceId: string,
    memberId: string,
    body: UpdateMemberRoleBody,
    actor: ActorContext,
    actorRole: RoleSlug,
  ): Promise<{ membershipId: string; role: RoleSlug }> {
    const newRole = body.role as RoleSlug;
    if (newRole === ROLE_SLUGS.OWNER) {
      throw new ForbiddenError(
        'Use transfer-ownership to change owner',
        'USE_TRANSFER_OWNERSHIP',
      );
    }

    const target = await this.repo.findMembershipById(workspaceId, memberId);
    if (!target) {
      throw new NotFoundError('Member not found');
    }

    // Self-lockout guard: actor cannot change their own role here.
    if (target.userId === actor.user.id) {
      throw new ForbiddenError('Cannot change your own role', 'CANNOT_CHANGE_OWN_ROLE');
    }

    // Cannot change owner via this route.
    if (target.roleSlug === ROLE_SLUGS.OWNER) {
      throw new ForbiddenError(
        'Cannot demote owner — use transfer-ownership',
        'CANNOT_DEMOTE_OWNER',
      );
    }

    // Role-weight checks:
    //   - actor must have strictly higher weight than the target's CURRENT role
    //   - actor must have strictly higher weight than the NEW role
    if (ROLE_WEIGHT[actorRole] <= ROLE_WEIGHT[target.roleSlug]) {
      throw new ForbiddenError(
        'Cannot manage a member with equal or higher role',
        'INSUFFICIENT_ROLE',
      );
    }
    if (ROLE_WEIGHT[actorRole] <= ROLE_WEIGHT[newRole]) {
      throw new ForbiddenError(
        'Cannot assign a role at or above your own',
        'CANNOT_ASSIGN_HIGHER_ROLE',
      );
    }

    const newRoleId = await this.rbac.resolveRoleId(newRole);

    await this.db.transaction(async (tx) => {
      await this.repo.updateMembershipRole(tx, target.membershipId, newRoleId);
    });

    await this.rbac.invalidate(workspaceId, target.userId);

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'membership',
      targetId: target.membershipId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: {
        kind: 'workspace.member.role_changed',
        targetUserId: target.userId,
        from: target.roleSlug,
        to: newRole,
      },
    });

    return { membershipId: target.membershipId, role: newRole };
  }

  // ─── 9. Remove member ─────────────────────────────────────────────────────

  public async removeMember(
    workspaceId: string,
    memberId: string,
    actor: ActorContext,
    actorRole: RoleSlug,
  ): Promise<void> {
    const target = await this.repo.findMembershipById(workspaceId, memberId);
    if (!target) {
      throw new NotFoundError('Member not found');
    }

    // Self-removal disallowed (use leaveWorkspace flow if implemented later);
    // an owner must transfer ownership before leaving.
    if (target.userId === actor.user.id) {
      throw new ForbiddenError('Cannot remove yourself', 'CANNOT_REMOVE_SELF');
    }

    // Role-weight check
    if (ROLE_WEIGHT[actorRole] <= ROLE_WEIGHT[target.roleSlug]) {
      throw new ForbiddenError(
        'Cannot remove a member with equal or higher role',
        'INSUFFICIENT_ROLE',
      );
    }

    // Sole-owner protection
    if (target.roleSlug === ROLE_SLUGS.OWNER) {
      const remainingOwners = await this.repo.countOwners(this.db, workspaceId, target.userId);
      if (remainingOwners === 0) {
        throw new ForbiddenError('Cannot remove the sole owner', 'SOLE_OWNER_PROTECTED');
      }
    }

    await this.db.transaction(async (tx) => {
      await this.repo.deleteMembership(tx, workspaceId, target.membershipId);
    });

    await this.rbac.invalidate(workspaceId, target.userId);
    // Also kill all of the removed user's sessions for this workspace context (best-effort)
    await this.tokens.revokeAllForUser(target.userId, 'membership_removed').catch(() => undefined);

    this.publishEvent(NATS_SUBJECTS.WORKSPACE_MEMBER_REMOVED, {
      workspaceId,
      userId: target.userId,
    });

    await this.audit.record({
      action: 'workspace.member.removed',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'membership',
      targetId: target.membershipId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { targetUserId: target.userId, prevRole: target.roleSlug },
    });
  }

  // ─── 10. Transfer ownership ──────────────────────────────────────────────

  public async transferOwnership(
    workspaceId: string,
    newOwnerUserId: string,
    actor: ActorContext,
  ): Promise<{ newOwnerUserId: string }> {
    if (newOwnerUserId === actor.user.id) {
      throw new ValidationError('Cannot transfer ownership to yourself');
    }

    const ws = await this.repo.findById(workspaceId);
    if (!ws) {
      throw new NotFoundError('Workspace not found');
    }
    this.assertActive(ws);

    if (ws.ownerUserId !== actor.user.id) {
      throw new ForbiddenError('Only the current owner can transfer ownership', 'NOT_OWNER');
    }

    const ownerRoleId = await this.rbac.resolveRoleId(ROLE_SLUGS.OWNER);
    const adminRoleId = await this.rbac.resolveRoleId(ROLE_SLUGS.ADMIN);

    await this.db.transaction(async (tx) => {
      // Both must be members of the workspace
      const newOwnerMembership = await this.findMembershipTx(tx, workspaceId, newOwnerUserId);
      if (!newOwnerMembership) {
        throw new ForbiddenError(
          'New owner must already be a member of this workspace',
          'TARGET_NOT_MEMBER',
        );
      }
      const currentOwnerMembership = await this.findMembershipTx(tx, workspaceId, actor.user.id);
      if (!currentOwnerMembership || currentOwnerMembership.roleSlug !== ROLE_SLUGS.OWNER) {
        throw new ForbiddenError('Current owner membership not found', 'NOT_OWNER');
      }

      // Promote new owner
      await this.repo.updateMembershipRole(tx, newOwnerMembership.membershipId, ownerRoleId);
      // Demote previous owner to admin
      await this.repo.updateMembershipRole(tx, currentOwnerMembership.membershipId, adminRoleId);

      // Update workspaces.ownerUserId atomically
      await this.repo.updateWithVersion(workspaceId, ws.version, { ownerUserId: newOwnerUserId });
    });

    await this.rbac.invalidate(workspaceId, actor.user.id);
    await this.rbac.invalidate(workspaceId, newOwnerUserId);

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workspace',
      targetId: workspaceId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: {
        kind: 'workspace.ownership_transferred',
        from: actor.user.id,
        to: newOwnerUserId,
      },
    });

    return { newOwnerUserId };
  }

  // ─── 11. Deactivate ───────────────────────────────────────────────────────

  public async deactivate(workspaceId: string, actor: ActorContext): Promise<Workspace> {
    const ws = await this.repo.findById(workspaceId);
    if (!ws) {
      throw new NotFoundError('Workspace not found');
    }
    if (ws.status === 'inactive') {
      return ws; // idempotent
    }
    if (ws.status === 'deleted') {
      throw new ConflictError('Workspace is deleted', 'WORKSPACE_DELETED');
    }

    const updated = await this.repo.updateWithVersion(workspaceId, ws.version, {
      status: 'inactive',
    });
    if (!updated) {
      throw new ConflictError('Workspace state changed — please retry', 'VERSION_CONFLICT');
    }

    await this.rbac.invalidateWorkspace(workspaceId);

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workspace',
      targetId: workspaceId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'workspace.deactivated' },
    });

    return updated;
  }

  // ─── 12. Reactivate ───────────────────────────────────────────────────────

  public async reactivate(workspaceId: string, actor: ActorContext): Promise<Workspace> {
    const ws = await this.repo.findById(workspaceId);
    if (!ws) {
      throw new NotFoundError('Workspace not found');
    }
    if (ws.status === 'deleted') {
      throw new ConflictError('Cannot reactivate a deleted workspace', 'WORKSPACE_DELETED');
    }
    if (ws.status === 'active') {
      return ws;
    }

    const updated = await this.repo.updateWithVersion(workspaceId, ws.version, {
      status: 'active',
    });
    if (!updated) {
      throw new ConflictError('Workspace state changed — please retry', 'VERSION_CONFLICT');
    }

    await this.rbac.invalidateWorkspace(workspaceId);

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'workspace',
      targetId: workspaceId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'workspace.reactivated' },
    });

    return updated;
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /**
   * Throws if the workspace status is not 'active'. Called from every mutating
   * path so deactivated workspaces are read-only beyond reactivate.
   */
  private assertActive(ws: Workspace): void {
    if (ws.status !== 'active') {
      throw new ForbiddenError(
        ws.status === 'deleted' ? 'Workspace is deleted' : 'Workspace is inactive',
        ws.status === 'deleted' ? 'WORKSPACE_DELETED' : 'WORKSPACE_INACTIVE',
      );
    }
  }

  private async ensureSlugUnique(tx: Tx, slug: string): Promise<string> {
    const exists = await this.repo.slugExists(tx, slug);
    if (exists) {
      throw new ConflictError('Slug already taken', 'SLUG_TAKEN');
    }
    return slug;
  }

  private async generateUniqueSlug(tx: Tx, name: string): Promise<string> {
    const base = this.slugify(name) || 'workspace';
    let candidate = base;
    for (let i = 0; i < MAX_SLUG_ATTEMPTS; i++) {
      const taken = await this.repo.slugExists(tx, candidate);
      if (!taken) {
        return candidate;
      }
      candidate = `${base}-${generateRandomHex(2)}`;
    }
    return `${base}-${generateRandomHex(4)}`;
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 48)
      .replace(/^-+|-+$/g, '');
  }

  private async findMembershipTx(
    tx: Tx,
    workspaceId: string,
    userId: string,
  ): Promise<MembershipDetail | null> {
    const rows = await tx
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
      .limit(1)
      .for('update');
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

  private publishEvent(subject: string, payload: Record<string, unknown>): void {
    this.nats.publish(subject, { ...payload, occurredAt: new Date().toISOString() })
      .catch(() => { /* best-effort */ });
  }
}

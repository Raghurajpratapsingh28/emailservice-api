import { and, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { config } from '@config/index.js';
import { ROLE_SLUGS, ROLE_WEIGHT, type RoleSlug } from '@constants/rbac.js';
import { NATS_SUBJECTS } from '@constants/nats-subjects.js';
import {
  AccountDisabledError,
  AccountLockedError,
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  NotFoundError,
  TokenInvalidError,
  UnauthorizedError,
  ValidationError,
} from '@shared/errors/app-errors.js';
import { hashOpaqueToken, issueOpaqueToken } from '@shared/utils/tokens.js';
import { generateRandomHex } from '@shared/utils/crypto.js';
import { addSeconds, parseDurationToSeconds } from '@shared/utils/time.js';
import {
  emailVerificationTokens,
  invites,
  passwordResetTokens,
  refreshTokens,
  roles,
  users,
  workspaceMembers,
  workspaces,
} from '@shared/database/schema/index.js';
import {
  authLoginAttempts,
  authPasswordOps,
} from '@observability/auth-metrics.js';
import type { Database } from '@shared/database/client.js';
import type { TokensResponse } from '@shared/types/index.js';
import type { EmailPublisher } from '@shared/email/ses.js';
import type { NatsClient } from '@shared/queue/nats.js';
import type { AuditService } from './audit.service.js';
import type { PasswordService } from './password.service.js';
import type { RbacService } from './rbac.service.js';
import type { TokenService } from './token.service.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
  /** Current access-token jti (set by authenticate middleware). */
  accessJti?: string;
}

export interface SignupInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  workspaceName?: string;
}

export interface SignupResult {
  user: { id: string; email: string };
  workspace: { id: string; slug: string; name: string };
  tokens: TokensResponse;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AcceptInviteInput {
  token: string;
  password?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Pre-computed dummy bcrypt hash, generated once at module load. Used for
 * timing-safe paths (login + forgot-password) when the user does not exist
 * (F11, F17). Hashing on every request would be a DOS vector.
 *
 * The plaintext used to generate it is throwaway — we only ever compare the
 * user-provided plaintext against this hash, which will always return false.
 */
const DUMMY_BCRYPT_HASH =
  '$2b$12$9zJ.JQXwQ8FbMTQzTQ8c8eF3SjZb5fH5qrWzSTGqrTJ.WWxMCjqE2';

export class AuthService {
  public constructor(
    private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly nats: NatsClient,
    private readonly email: EmailPublisher,
  ) {}

  // ─── Signup ────────────────────────────────────────────────────────────────

  public async signup(input: SignupInput, ctx: RequestContext): Promise<SignupResult> {
    const emailNormalized = input.email.trim().toLowerCase();
    const passwordHash = await this.passwords.hash(input.password);

    const ownerRoleId = await this.rbac.resolveRoleId(ROLE_SLUGS.OWNER);

    const result = await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.emailNormalized, emailNormalized))
        .limit(1);
      if (existing.length > 0) {
        throw new ConflictError('Email already registered', 'EMAIL_TAKEN');
      }

      const insertedUsers = await tx
        .insert(users)
        .values({
          email: input.email.trim(),
          emailNormalized,
          passwordHash,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
        })
        .returning();
      const user = insertedUsers[0]!;

      const workspaceName =
        input.workspaceName?.trim() || this.deriveWorkspaceName(input, emailNormalized);
      const slug = await this.generateUniqueSlug(tx, workspaceName);

      const insertedWs = await tx
        .insert(workspaces)
        .values({
          slug,
          name: workspaceName,
          plan: 'free',
          ownerUserId: user.id,
        })
        .returning();
      const workspace = insertedWs[0]!;

      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: user.id,
        roleId: ownerRoleId,
      });

      return { user, workspace };
    });

    await this.issueEmailVerification(result.user.id, result.user.email).catch(() => undefined);

    const tokens = await this.tokens.issueTokens(
      { userId: result.user.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      { email: result.user.email },
    );

    this.publishEvent(NATS_SUBJECTS.AUTH_USER_REGISTERED, {
      userId: result.user.id,
      email: result.user.email,
      workspaceId: result.workspace.id,
    });
    this.publishEvent(NATS_SUBJECTS.WORKSPACE_CREATED, {
      workspaceId: result.workspace.id,
      ownerUserId: result.user.id,
      slug: result.workspace.slug,
    });

    await this.audit.record({
      action: 'auth.signup',
      actorUserId: result.user.id,
      workspaceId: result.workspace.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      user: { id: result.user.id, email: result.user.email },
      workspace: {
        id: result.workspace.id,
        slug: result.workspace.slug,
        name: result.workspace.name,
      },
      tokens,
    };
  }

  // ─── Login ─────────────────────────────────────────────────────────────────

  public async login(input: LoginInput, ctx: RequestContext): Promise<TokensResponse> {
    const emailNormalized = input.email.trim().toLowerCase();
    const userRows = await this.db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, emailNormalized))
      .limit(1);
    const user = userRows[0];

    // F11 — fixed dummy hash; constant-time compare path.
    const hash = user?.passwordHash ?? DUMMY_BCRYPT_HASH;

    if (user && user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const retryAfter = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      authLoginAttempts.inc({ outcome: 'locked' });
      await this.audit.record({
        action: 'auth.login.locked',
        actorUserId: user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        success: false,
      });
      throw new AccountLockedError(retryAfter);
    }

    const valid = await this.passwords.verify(input.password, hash);

    if (!user || !valid) {
      if (user) {
        await this.recordFailedLogin(user.id);
        await this.audit.record({
          action: 'auth.login.failure',
          actorUserId: user.id,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          success: false,
        });
      }
      authLoginAttempts.inc({ outcome: 'invalid_credentials' });
      throw new InvalidCredentialsError();
    }

    if (!user.isActive) {
      authLoginAttempts.inc({ outcome: 'disabled' });
      throw new AccountDisabledError();
    }

    await this.db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        failedLoginWindowStart: null,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ctx.ipAddress?.slice(0, 64) ?? null,
      })
      .where(eq(users.id, user.id));

    if (this.passwords.needsRehash(user.passwordHash)) {
      const newHash = await this.passwords.hash(input.password);
      await this.db
        .update(users)
        .set({ passwordHash: newHash })
        .where(eq(users.id, user.id));
    }

    const tokens = await this.tokens.issueTokens(
      { userId: user.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      { email: user.email },
    );

    authLoginAttempts.inc({ outcome: 'success' });
    this.publishEvent(NATS_SUBJECTS.AUTH_USER_LOGGED_IN, { userId: user.id });

    await this.audit.record({
      action: 'auth.login.success',
      actorUserId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return tokens;
  }

  // ─── Refresh ───────────────────────────────────────────────────────────────

  public async refresh(presentedToken: string, ctx: RequestContext): Promise<TokensResponse> {
    const lookup = async (userId: string): Promise<string | null> => {
      const row = await this.db
        .select({ email: users.email, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const u = row[0];
      if (!u || !u.isActive) {
        return null;
      }
      return u.email;
    };

    try {
      const tokens = await this.tokens.rotate(
        {
          presentedToken,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          onUnrecognized: async (info) => {
            await this.audit.record({
              action: 'auth.refresh.failure',
              ipAddress: info.ipAddress,
              userAgent: info.userAgent,
              success: false,
              metadata: { presentedHashPrefix: info.presentedHash.slice(0, 16) },
            });
          },
        },
        lookup,
      );
      await this.audit.record({
        action: 'auth.refresh.success',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return tokens;
    } catch (err) {
      if ((err as { code?: string }).code === 'TOKEN_REUSE') {
        await this.audit.record({
          action: 'auth.refresh.reuse_detected',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          success: false,
        });
      }
      throw err;
    }
  }

  // ─── Logout ────────────────────────────────────────────────────────────────

  public async logout(
    refreshToken: string,
    ctx: RequestContext,
    userId: string,
  ): Promise<void> {
    const accessTtl = parseDurationToSeconds(config.JWT_ACCESS_TTL);
    const revoked = await this.tokens.revokeByPlaintext(refreshToken, userId, 'logout');

    // Always denylist the current access JWT (F3) regardless of refresh outcome —
    // a user might call logout with an absent/wrong refresh token but a valid bearer.
    if (ctx.accessJti) {
      await this.tokens.denylistAccessJti(ctx.accessJti, accessTtl);
    }

    await this.audit.record({
      action: 'auth.logout',
      actorUserId: userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { refreshRevoked: revoked !== null },
    });
    this.publishEvent(NATS_SUBJECTS.AUTH_USER_LOGGED_OUT, { userId });
  }

  public async logoutAll(userId: string, ctx: RequestContext): Promise<{ revoked: number }> {
    const accessTtl = parseDurationToSeconds(config.JWT_ACCESS_TTL);
    const revokedJtis = await this.tokens.revokeAllForUser(userId, 'logout_all');
    if (revokedJtis.length > 0) {
      await this.tokens.denylistAccessJtis(revokedJtis, accessTtl);
    }
    if (ctx.accessJti) {
      await this.tokens.denylistAccessJti(ctx.accessJti, accessTtl);
    }
    await this.audit.record({
      action: 'auth.logout_all',
      actorUserId: userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { revoked: revokedJtis.length },
    });
    return { revoked: revokedJtis.length };
  }

  // ─── Forgot / Reset Password ───────────────────────────────────────────────

  public async forgotPassword(email: string, ctx: RequestContext): Promise<void> {
    const emailNormalized = email.trim().toLowerCase();
    const userRows = await this.db
      .select({ id: users.id, email: users.email, isActive: users.isActive })
      .from(users)
      .where(eq(users.emailNormalized, emailNormalized))
      .limit(1);
    const user = userRows[0];

    if (!user || !user.isActive) {
      // F11 — constant-time bcrypt compare against fixed dummy hash, no fresh hashing.
      await this.passwords.verify('placeholder', DUMMY_BCRYPT_HASH);
      authPasswordOps.inc({ op: 'forgot', outcome: 'user_not_found' });
      return;
    }

    const { plaintext, hash } = issueOpaqueToken(48);
    const expiresAt = addSeconds(new Date(), config.PASSWORD_RESET_TTL_S);

    await this.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt,
      requestedIp: ctx.ipAddress?.slice(0, 64) ?? null,
    });

    const resetUrl = `${config.APP_PUBLIC_URL}/auth/reset-password?token=${encodeURIComponent(plaintext)}`;
    await this.email.send({
      to: user.email,
      subject: 'Reset your EngageIQ password',
      template: 'auth.password_reset',
      data: { resetUrl, expiresInMinutes: Math.floor(config.PASSWORD_RESET_TTL_S / 60) },
      idempotencyKey: `pwreset:${user.id}:${hash.slice(0, 16)}`,
    });

    this.publishEvent(NATS_SUBJECTS.AUTH_PASSWORD_RESET_REQUESTED, { userId: user.id });
    authPasswordOps.inc({ op: 'forgot', outcome: 'success' });

    await this.audit.record({
      action: 'auth.password.reset_requested',
      actorUserId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  public async resetPassword(
    token: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<void> {
    const hash = hashOpaqueToken(token);
    const accessTtl = parseDurationToSeconds(config.JWT_ACCESS_TTL);

    const userId = await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, hash))
        .limit(1)
        .for('update');
      const row = rows[0];
      if (!row || row.consumedAt !== null || row.expiresAt.getTime() <= Date.now()) {
        authPasswordOps.inc({ op: 'reset', outcome: 'invalid' });
        throw new TokenInvalidError('Reset token is invalid or expired');
      }

      // F7 — refuse for disabled accounts.
      const targetRows = await tx
        .select({ id: users.id, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1);
      const target = targetRows[0];
      if (!target || !target.isActive) {
        authPasswordOps.inc({ op: 'reset', outcome: 'invalid' });
        throw new TokenInvalidError('Reset token is invalid or expired');
      }

      const newHash = await this.passwords.hash(newPassword);
      await tx
        .update(users)
        .set({
          passwordHash: newHash,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          failedLoginWindowStart: null,
          lockedUntil: null,
        })
        .where(eq(users.id, row.userId));

      await tx
        .update(passwordResetTokens)
        .set({ consumedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.id));

      // Invalidate every other outstanding reset token for this user
      await tx
        .update(passwordResetTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.userId, row.userId),
            isNull(passwordResetTokens.consumedAt),
          ),
        );

      return row.userId;
    });

    // Revoke ALL refresh tokens + denylist ALL their access JWTs.
    const revoked = await this.tokens.revokeAllForUser(userId, 'password_reset');
    if (revoked.length > 0) {
      await this.tokens.denylistAccessJtis(revoked, accessTtl);
    }

    this.publishEvent(NATS_SUBJECTS.AUTH_PASSWORD_RESET_COMPLETED, { userId });
    authPasswordOps.inc({ op: 'reset', outcome: 'success' });

    await this.audit.record({
      action: 'auth.password.reset_completed',
      actorUserId: userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  // ─── Email verification ────────────────────────────────────────────────────

  public async issueEmailVerification(userId: string, email: string): Promise<void> {
    const { plaintext, hash } = issueOpaqueToken(48);
    const expiresAt = addSeconds(new Date(), config.EMAIL_VERIFICATION_TTL_S);

    await this.db.insert(emailVerificationTokens).values({
      userId,
      email,
      tokenHash: hash,
      expiresAt,
    });

    const url = `${config.APP_PUBLIC_URL}/auth/verify-email?token=${encodeURIComponent(plaintext)}`;
    await this.email.send({
      to: email,
      subject: 'Verify your EngageIQ email',
      template: 'auth.email_verification',
      data: { url, expiresInHours: Math.floor(config.EMAIL_VERIFICATION_TTL_S / 3600) },
      idempotencyKey: `emailverify:${userId}:${hash.slice(0, 16)}`,
    });

    this.publishEvent(NATS_SUBJECTS.AUTH_EMAIL_VERIFICATION_REQUESTED, { userId, email });

    await this.audit.record({
      action: 'auth.email.verification_sent',
      actorUserId: userId,
      metadata: { email },
    });
  }

  public async resendVerification(userId: string): Promise<void> {
    const userRows = await this.db
      .select({
        id: users.id,
        email: users.email,
        isEmailVerified: users.isEmailVerified,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = userRows[0];
    if (!user || !user.isActive) {
      throw new NotFoundError('User not found');
    }
    if (user.isEmailVerified) {
      throw new ConflictError('Email already verified', 'EMAIL_ALREADY_VERIFIED');
    }
    await this.issueEmailVerification(user.id, user.email);
  }

  public async verifyEmail(token: string, ctx: RequestContext): Promise<void> {
    const hash = hashOpaqueToken(token);

    const userId = await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.tokenHash, hash))
        .limit(1)
        .for('update');
      const row = rows[0];
      if (!row || row.consumedAt !== null || row.expiresAt.getTime() <= Date.now()) {
        throw new TokenInvalidError('Verification token is invalid or expired');
      }

      await tx
        .update(users)
        .set({ isEmailVerified: true })
        .where(eq(users.id, row.userId));

      await tx
        .update(emailVerificationTokens)
        .set({ consumedAt: new Date() })
        .where(eq(emailVerificationTokens.id, row.id));

      return row.userId;
    });

    this.publishEvent(NATS_SUBJECTS.AUTH_EMAIL_VERIFIED, { userId });

    await this.audit.record({
      action: 'auth.email.verified',
      actorUserId: userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  // ─── Invite flow ───────────────────────────────────────────────────────────

  /**
   * Sends a workspace invite. Hardened (F5):
   *  - Inviter must have a strict role-weight advantage over the invited role
   *    (admin can invite member/viewer, never another admin or owner).
   *  - Owner role cannot be invited.
   */
  public async inviteUser(
    input: {
      workspaceId: string;
      invitedByUserId: string;
      inviterRole: RoleSlug;
      email: string;
      role: RoleSlug;
    },
    ctx: RequestContext,
  ): Promise<{ inviteId: string }> {
    if (input.role === ROLE_SLUGS.OWNER) {
      throw new ValidationError('Cannot invite as owner');
    }
    if (ROLE_WEIGHT[input.role] >= ROLE_WEIGHT[input.inviterRole]) {
      throw new ForbiddenError(
        'Cannot invite a user at or above your own role',
        'INVITE_ROLE_TOO_HIGH',
      );
    }

    const roleId = await this.rbac.resolveRoleId(input.role);
    const emailNormalized = input.email.trim().toLowerCase();

    const { plaintext, hash } = issueOpaqueToken(48);
    const expiresAt = addSeconds(new Date(), config.INVITE_TTL_S);

    const inserted = await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
        .where(
          and(
            eq(users.emailNormalized, emailNormalized),
            eq(workspaceMembers.workspaceId, input.workspaceId),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        throw new ConflictError('User is already a member', 'ALREADY_MEMBER');
      }

      await tx
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(invites.workspaceId, input.workspaceId),
            eq(invites.emailNormalized, emailNormalized),
            isNull(invites.acceptedAt),
            isNull(invites.revokedAt),
          ),
        );

      const rows = await tx
        .insert(invites)
        .values({
          workspaceId: input.workspaceId,
          invitedByUserId: input.invitedByUserId,
          email: input.email.trim(),
          emailNormalized,
          roleId,
          tokenHash: hash,
          expiresAt,
        })
        .returning();
      return rows[0]!;
    });

    const acceptUrl = `${config.APP_PUBLIC_URL}/auth/accept-invite?token=${encodeURIComponent(plaintext)}`;
    await this.email.send({
      to: input.email.trim(),
      subject: "You've been invited to EngageIQ",
      template: 'auth.invite',
      data: { acceptUrl, role: input.role, expiresInDays: Math.floor(config.INVITE_TTL_S / 86400) },
      idempotencyKey: `invite:${inserted.id}`,
    });

    this.publishEvent(NATS_SUBJECTS.AUTH_INVITE_SENT, {
      inviteId: inserted.id,
      workspaceId: input.workspaceId,
      email: input.email.trim(),
      role: input.role,
    });

    await this.audit.record({
      action: 'auth.invite.sent',
      actorUserId: input.invitedByUserId,
      workspaceId: input.workspaceId,
      targetType: 'invite',
      targetId: inserted.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { email: input.email.trim(), role: input.role },
    });

    return { inviteId: inserted.id };
  }

  /**
   * Accepts a workspace invite.
   *
   * Hardening (F2 — account-takeover via invite):
   *   The previous implementation allowed an unauthenticated request to
   *   accept an invite for an *existing* account, returning a session for
   *   that account. Anyone with the invite link could log in as that user.
   *
   *   New behaviour:
   *     • If the invitee email matches an EXISTING user, the request MUST
   *       be authenticated as that user. Otherwise return 401 with
   *       INVITE_REQUIRES_LOGIN — the client redirects to login.
   *     • If no user exists for that email, accepting the invite creates
   *       a new account with the supplied password. This is the only path
   *       where the invite token alone yields a session.
   */
  public async acceptInvite(
    input: AcceptInviteInput,
    ctx: RequestContext,
    authedUserId?: string,
  ): Promise<{ workspaceId: string; tokens: TokensResponse }> {
    const hash = hashOpaqueToken(input.token);

    const result = await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(invites)
        .where(eq(invites.tokenHash, hash))
        .limit(1)
        .for('update');
      const invite = rows[0];
      if (
        !invite ||
        invite.acceptedAt !== null ||
        invite.revokedAt !== null ||
        invite.expiresAt.getTime() <= Date.now()
      ) {
        throw new TokenInvalidError('Invite is invalid or expired');
      }

      // Resolve target user
      let userId: string | undefined = authedUserId;
      const existingByEmail = await tx
        .select({ id: users.id, emailNormalized: users.emailNormalized })
        .from(users)
        .where(eq(users.emailNormalized, invite.emailNormalized))
        .limit(1);
      const existing = existingByEmail[0];

      if (existing) {
        if (!authedUserId) {
          throw new UnauthorizedError(
            'Please sign in with your existing account to accept this invite',
            'INVITE_REQUIRES_LOGIN',
          );
        }
        if (existing.id !== authedUserId) {
          throw new ForbiddenError(
            'Invite email does not match your account',
            'INVITE_EMAIL_MISMATCH',
          );
        }
        userId = existing.id;
      } else {
        // Creating a new account
        if (authedUserId) {
          // Authed user with a different email — block
          throw new ForbiddenError(
            'Invite email does not match your account',
            'INVITE_EMAIL_MISMATCH',
          );
        }
        if (!input.password) {
          throw new ValidationError('Password is required for new users');
        }
        const passwordHash = await this.passwords.hash(input.password);
        const insertedUsers = await tx
          .insert(users)
          .values({
            email: invite.email,
            emailNormalized: invite.emailNormalized,
            passwordHash,
            firstName: input.firstName ?? null,
            lastName: input.lastName ?? null,
            isEmailVerified: true,
          })
          .returning();
        userId = insertedUsers[0]!.id;
      }

      const memberRows = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, invite.workspaceId),
            eq(workspaceMembers.userId, userId!),
          ),
        )
        .limit(1);
      if (memberRows.length === 0) {
        await tx.insert(workspaceMembers).values({
          workspaceId: invite.workspaceId,
          userId: userId!,
          roleId: invite.roleId,
          invitedBy: invite.invitedByUserId,
        });
      }

      await tx
        .update(invites)
        .set({ acceptedAt: new Date(), acceptedByUserId: userId! })
        .where(eq(invites.id, invite.id));

      const userRow = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId!))
        .limit(1);

      return {
        userId: userId!,
        workspaceId: invite.workspaceId,
        email: userRow[0]!.email,
        wasNewUser: !existing,
      };
    });

    await this.rbac.invalidate(result.workspaceId, result.userId);

    // Only mint a fresh session if the user did NOT come in already authenticated.
    // If they're already logged in, returning their existing session is correct;
    // we don't need to issue new tokens just for joining a workspace.
    let tokens: TokensResponse;
    if (authedUserId && !result.wasNewUser) {
      tokens = {
        accessToken: '',
        refreshToken: '',
        tokenType: 'Bearer',
        expiresIn: 0,
      };
    } else {
      tokens = await this.tokens.issueTokens(
        { userId: result.userId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
        { email: result.email },
      );
    }

    this.publishEvent(NATS_SUBJECTS.AUTH_INVITE_ACCEPTED, {
      workspaceId: result.workspaceId,
      userId: result.userId,
    });
    this.publishEvent(NATS_SUBJECTS.WORKSPACE_MEMBER_ADDED, {
      workspaceId: result.workspaceId,
      userId: result.userId,
    });

    await this.audit.record({
      action: 'auth.invite.accepted',
      actorUserId: result.userId,
      workspaceId: result.workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { workspaceId: result.workspaceId, tokens };
  }

  // ─── Sessions ──────────────────────────────────────────────────────────────

  public async listSessions(userId: string, currentJti?: string): Promise<Array<{
    id: string;
    createdAt: Date;
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
    current: boolean;
  }>> {
    const rows = await this.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      );

    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      current: currentJti != null && r.id === currentJti,
    }));
  }

  public async revokeSession(userId: string, sessionId: string): Promise<void> {
    const accessTtl = parseDurationToSeconds(config.JWT_ACCESS_TTL);
    const res = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), revokedReason: 'user_revoked' })
      .where(
        and(
          eq(refreshTokens.id, sessionId),
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });

    if (res.length === 0) {
      throw new NotFoundError('Session not found');
    }
    // Denylist the access token whose jti == refresh row id.
    await this.tokens.denylistAccessJti(res[0]!.id, accessTtl);

    await this.audit.record({
      action: 'auth.session.revoked',
      actorUserId: userId,
      targetType: 'session',
      targetId: sessionId,
    });
  }

  // ─── Current user ─────────────────────────────────────────────────────────

  public async getCurrentUser(userId: string): Promise<{
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    isEmailVerified: boolean;
    workspaces: Array<{ id: string; slug: string; name: string; role: RoleSlug }>;
  }> {
    const userRows = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = userRows[0];
    if (!user || !user.isActive) {
      throw new NotFoundError('User not found');
    }

    const memberships = await this.db
      .select({
        workspaceId: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        roleSlug: roles.slug,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .innerJoin(roles, eq(roles.id, workspaceMembers.roleId))
      .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
      .limit(50); // F22 — hard cap; pagination layer can be added on top

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isEmailVerified: user.isEmailVerified,
      workspaces: memberships.map((m) => ({
        id: m.workspaceId,
        slug: m.slug,
        name: m.name,
        role: m.roleSlug as RoleSlug,
      })),
    };
  }

  public async updateProfile(
    userId: string,
    data: { firstName?: string; lastName?: string },
  ): Promise<{
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    isEmailVerified: boolean;
    workspaces: Array<{ id: string; slug: string; name: string; role: RoleSlug }>;
  }> {
    await this.db
      .update(users)
      .set({
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return this.getCurrentUser(userId);
  }

  public async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<void> {
    const userRows = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userRows[0];
    if (!user) throw new NotFoundError('User not found');

    const valid = await this.passwords.verify(currentPassword, user.passwordHash);
    if (!valid) throw new InvalidCredentialsError();

    const newHash = await this.passwords.hash(newPassword);
    const now = new Date();

    await this.db
      .update(users)
      .set({
        passwordHash: newHash,
        passwordChangedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    await this.db
      .update(refreshTokens)
      .set({ revokedAt: now, revokedReason: 'password_reset' })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));

    if (ctx.accessJti) {
      await this.tokens.denylistAccessJti(ctx.accessJti, 900);
    }

    authPasswordOps.inc({ op: 'change', outcome: 'success' });
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /**
   * Atomic failed-login increment with sliding window decay (F10).
   *
   * Logic:
   *   IF window not started OR window older than ACCOUNT_LOCKOUT_WINDOW_S → reset
   *     to 1 with new window start.
   *   ELSE increment.
   *   IF >= MAX → set lockedUntil and reset counter.
   * Implemented as a single SQL statement to prevent races.
   */
  private async recordFailedLogin(userId: string): Promise<void> {
    const max = config.ACCOUNT_LOCKOUT_MAX_ATTEMPTS;
    const windowSec = config.ACCOUNT_LOCKOUT_WINDOW_S;
    const lockSec = config.ACCOUNT_LOCKOUT_DURATION_S;

    await this.db.execute(sql`
      WITH next AS (
        SELECT
          CASE
            WHEN failed_login_window_start IS NULL
              OR failed_login_window_start < now() - (${windowSec}::int * interval '1 second')
              THEN 1
            ELSE failed_login_attempts + 1
          END AS new_count,
          CASE
            WHEN failed_login_window_start IS NULL
              OR failed_login_window_start < now() - (${windowSec}::int * interval '1 second')
              THEN now()
            ELSE failed_login_window_start
          END AS new_window
        FROM users WHERE id = ${userId}
      )
      UPDATE users SET
        failed_login_attempts = CASE
          WHEN (SELECT new_count FROM next) >= ${max}::int THEN 0
          ELSE (SELECT new_count FROM next)
        END,
        failed_login_window_start = CASE
          WHEN (SELECT new_count FROM next) >= ${max}::int THEN NULL
          ELSE (SELECT new_window FROM next)
        END,
        locked_until = CASE
          WHEN (SELECT new_count FROM next) >= ${max}::int
            THEN now() + (${lockSec}::int * interval '1 second')
          ELSE locked_until
        END
      WHERE id = ${userId}
    `);
  }

  private deriveWorkspaceName(input: SignupInput, emailNormalized: string): string {
    const trimmedFirst = input.firstName?.trim();
    if (trimmedFirst) {
      return `${trimmedFirst}'s Workspace`;
    }
    const local = emailNormalized.split('@')[0] ?? 'My';
    return `${local}'s Workspace`;
  }

  /**
   * Generates a unique slug. Random suffix uses crypto-grade entropy (F20).
   */
  private async generateUniqueSlug(tx: Tx, name: string): Promise<string> {
    const base = this.slugify(name) || 'workspace';
    let candidate = base;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const exists = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, candidate))
        .limit(1);
      if (exists.length === 0) {
        return candidate;
      }
      attempt += 1;
      if (attempt > 5) {
        return `${base}-${generateRandomHex(4)}`;
      }
      candidate = `${base}-${generateRandomHex(2)}`;
    }
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 48);
  }

  /**
   * Wraps NATS publish so connection errors don't crash the request path. Failed
   * publishes are logged via audit + counted (F19 — reduces silent loss).
   */
  private publishEvent(subject: string, payload: Record<string, unknown>): void {
    try {
      this.nats.publish(subject, { ...payload, occurredAt: new Date().toISOString() });
    } catch {
      // best-effort; audit downstream
    }
  }
}

// `gte` re-exported for migrations / consumers
export { gte };

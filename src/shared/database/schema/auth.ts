import {
  boolean,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { roles } from './roles.js';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

/**
 * Refresh tokens — hashed at rest. Plaintext given to user once, never stored.
 *
 * Hardening:
 *  - `previousTokenHash` enables a small grace window during rotation: if the
 *    immediately-prior token in a family is presented within `rotationGraceUntil`,
 *    we accept it (replay of legit concurrent client) without nuking the family.
 *  - `revokedReason` is a typed enum-like string for analytics.
 *  - Cascade delete on user deletion.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar({ length: 128 }).notNull(),
    /** Hash of the immediately-previous token in this family — see grace window. */
    previousTokenHash: varchar({ length: 128 }),
    rotationGraceUntil: timestamp({ withTimezone: true }),
    familyId: uuid().notNull(),
    replacedById: uuid(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: varchar({ length: 64 }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    userAgent: varchar({ length: 512 }),
    ipAddress: varchar({ length: 64 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_uniq').on(t.tokenHash),
    index('refresh_tokens_prev_hash_idx').on(t.previousTokenHash),
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_user_active_idx').on(t.userId, t.revokedAt),
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_expires_idx').on(t.expiresAt),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar({ length: 128 }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    requestedIp: varchar({ length: 64 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_reset_tokens_token_hash_uniq').on(t.tokenHash),
    index('password_reset_tokens_user_idx').on(t.userId),
    index('password_reset_tokens_expires_idx').on(t.expiresAt),
  ],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: varchar({ length: 254 }).notNull(),
    tokenHash: varchar({ length: 128 }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('email_verification_tokens_token_hash_uniq').on(t.tokenHash),
    index('email_verification_tokens_user_idx').on(t.userId),
    index('email_verification_tokens_expires_idx').on(t.expiresAt),
  ],
);

export const invites = pgTable(
  'invites',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    invitedByUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: varchar({ length: 254 }).notNull(),
    emailNormalized: varchar({ length: 254 }).notNull(),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    tokenHash: varchar({ length: 128 }).notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    acceptedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invites_token_hash_uniq').on(t.tokenHash),
    index('invites_workspace_email_idx').on(t.workspaceId, t.emailNormalized),
    index('invites_email_idx').on(t.emailNormalized),
    index('invites_expires_idx').on(t.expiresAt),
  ],
);

/**
 * Audit log — append-only.
 *
 * Hardening:
 *  - `metadata` is `jsonb` (was `text`) for structured queries / SIEM ingestion.
 *  - Foreign keys are nullable + `set null` on actor deletion so audit history
 *    survives user deletion (regulatory).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().references(() => workspaces.id, { onDelete: 'set null' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: varchar({ length: 100 }).notNull(),
    targetType: varchar({ length: 64 }),
    targetId: varchar({ length: 128 }),
    success: boolean().notNull().default(true),
    ipAddress: varchar({ length: 64 }),
    userAgent: varchar({ length: 512 }),
    metadata: jsonb(),
    /** Optional correlation id for cross-trace correlation. */
    requestId: varchar({ length: 64 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_workspace_idx').on(t.workspaceId),
    index('audit_logs_actor_idx').on(t.actorUserId),
    index('audit_logs_action_idx').on(t.action),
    index('audit_logs_action_created_idx').on(t.action, t.createdAt),
    index('audit_logs_created_idx').on(t.createdAt),
  ],
);

// Re-export 'text' so existing consumers compile if needed
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert;
export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

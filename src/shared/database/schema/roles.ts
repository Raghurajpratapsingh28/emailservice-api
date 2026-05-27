import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { workspaces } from './workspaces.js';

/**
 * Roles are global definitions ("owner", "admin", "member", "viewer"). The set is
 * seeded once and shared across workspaces — the per-workspace assignment lives on
 * `workspace_members.roleId`.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: varchar({ length: 64 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    description: text(),
    /** Higher == more privileged. Seed values: owner=100, admin=75, member=50, viewer=25. */
    weight: varchar({ length: 16 }).notNull().default('0'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('roles_slug_uniq').on(t.slug)],
);

/**
 * Permissions catalog. Granular `<resource>.<action>` strings.
 * Seeded once and referenced by `role_permissions`.
 */
export const permissions = pgTable(
  'permissions',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: varchar({ length: 128 }).notNull(),
    description: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('permissions_slug_uniq').on(t.slug)],
);

/**
 * role -> permission mapping. Composite primary key prevents duplicates.
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid()
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index('role_permissions_role_idx').on(t.roleId),
    index('role_permissions_perm_idx').on(t.permissionId),
  ],
);

/**
 * workspace_members joins user <-> workspace with a role. A user may belong to many
 * workspaces, with a different role in each.
 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid()
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    joinedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workspace_members_workspace_user_uniq').on(t.workspaceId, t.userId),
    index('workspace_members_user_idx').on(t.userId),
    index('workspace_members_role_idx').on(t.roleId),
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;

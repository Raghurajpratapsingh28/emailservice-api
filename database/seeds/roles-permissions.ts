/**
 * Seeds the global roles + permissions catalog and the role-permission matrix.
 * Idempotent: safe to run repeatedly.
 */
import { eq } from 'drizzle-orm';
import {
  ALL_PERMISSIONS,
  ALL_ROLE_SLUGS,
  ROLE_PERMISSIONS,
  ROLE_SLUGS,
  ROLE_WEIGHT,
  type Permission as PermSlug,
  type RoleSlug,
} from '../../src/constants/rbac.js';
import {
  permissions,
  rolePermissions,
  roles,
} from '../../src/shared/database/schema/index.js';
import type { Database } from '../../src/shared/database/client.js';

const ROLE_DESCRIPTIONS: Record<RoleSlug, string> = {
  [ROLE_SLUGS.OWNER]: 'Workspace owner — full control including billing and deletion',
  [ROLE_SLUGS.ADMIN]: 'Workspace admin — manage members and content',
  [ROLE_SLUGS.MEMBER]: 'Standard member — read/write content, no admin actions',
  [ROLE_SLUGS.VIEWER]: 'Read-only access',
};

const ROLE_NAMES: Record<RoleSlug, string> = {
  [ROLE_SLUGS.OWNER]: 'Owner',
  [ROLE_SLUGS.ADMIN]: 'Admin',
  [ROLE_SLUGS.MEMBER]: 'Member',
  [ROLE_SLUGS.VIEWER]: 'Viewer',
};

export async function seedRolesAndPermissions(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // Upsert permissions
    const permissionRows = await Promise.all(
      ALL_PERMISSIONS.map(async (slug) => {
        const existing = await tx.select().from(permissions).where(eq(permissions.slug, slug)).limit(1);
        if (existing.length > 0) {
          return existing[0]!;
        }
        const inserted = await tx
          .insert(permissions)
          .values({ slug, description: `Permission: ${slug}` })
          .returning();
        return inserted[0]!;
      }),
    );
    const permissionBySlug = new Map<PermSlug, string>(
      permissionRows.map((r) => [r.slug as PermSlug, r.id]),
    );

    // Upsert roles
    const roleRows = await Promise.all(
      ALL_ROLE_SLUGS.map(async (slug) => {
        const existing = await tx.select().from(roles).where(eq(roles.slug, slug)).limit(1);
        if (existing.length > 0) {
          return existing[0]!;
        }
        const inserted = await tx
          .insert(roles)
          .values({
            slug,
            name: ROLE_NAMES[slug],
            description: ROLE_DESCRIPTIONS[slug],
            weight: String(ROLE_WEIGHT[slug]),
          })
          .returning();
        return inserted[0]!;
      }),
    );
    const roleBySlug = new Map<RoleSlug, string>(
      roleRows.map((r) => [r.slug as RoleSlug, r.id]),
    );

    // Reset and insert role-permission mapping
    for (const slug of ALL_ROLE_SLUGS) {
      const roleId = roleBySlug.get(slug)!;
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      const perms = ROLE_PERMISSIONS[slug];
      if (perms.length > 0) {
        await tx.insert(rolePermissions).values(
          perms.map((p) => ({
            roleId,
            permissionId: permissionBySlug.get(p)!,
          })),
        );
      }
    }
  });
}

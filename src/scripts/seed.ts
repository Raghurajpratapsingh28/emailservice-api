import { eq } from 'drizzle-orm';
import { createDb } from '../shared/database/client.js';
import { permissions, rolePermissions, roles } from '../shared/database/schema/index.js';
import {
  ALL_PERMISSIONS,
  ALL_ROLE_SLUGS,
  ROLE_PERMISSIONS,
  ROLE_WEIGHT,
  type Permission as PermSlug,
  type RoleSlug,
} from '../constants/rbac.js';

const ROLE_NAMES: Record<RoleSlug, string> = {
  owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer',
};

const { db, client } = createDb();
try {
  console.log('[seed] seeding roles and permissions...');
  await db.transaction(async (tx) => {
    const permRows = await Promise.all(
      ALL_PERMISSIONS.map(async (slug) => {
        const ex = await tx.select().from(permissions).where(eq(permissions.slug, slug)).limit(1);
        if (ex.length > 0) return ex[0]!;
        const ins = await tx.insert(permissions).values({ slug, description: slug }).returning();
        return ins[0]!;
      }),
    );
    const permBySlug = new Map<PermSlug, string>(permRows.map((r) => [r.slug as PermSlug, r.id]));

    const roleRows = await Promise.all(
      ALL_ROLE_SLUGS.map(async (slug) => {
        const ex = await tx.select().from(roles).where(eq(roles.slug, slug)).limit(1);
        if (ex.length > 0) return ex[0]!;
        const ins = await tx.insert(roles).values({ slug, name: ROLE_NAMES[slug], weight: String(ROLE_WEIGHT[slug]) }).returning();
        return ins[0]!;
      }),
    );
    const roleBySlug = new Map<RoleSlug, string>(roleRows.map((r) => [r.slug as RoleSlug, r.id]));

    for (const slug of ALL_ROLE_SLUGS) {
      const roleId = roleBySlug.get(slug)!;
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      const perms = ROLE_PERMISSIONS[slug];
      if (perms.length > 0) {
        await tx.insert(rolePermissions).values(
          perms.map((p) => ({ roleId, permissionId: permBySlug.get(p)! })),
        );
      }
    }
  });
  console.log('[seed] done.');
} finally {
  await client.end({ timeout: 5 });
}

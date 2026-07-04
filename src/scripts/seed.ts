import { createHash, randomBytes } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { createDb } from '../shared/database/client.js';
import { permissions, rolePermissions, roles } from '../shared/database/schema/index.js';
import { workspaces } from '../shared/database/schema/workspaces.js';
import { apiKeys } from '../shared/database/schema/api-keys.js';
import {
  ALL_PERMISSIONS,
  ALL_ROLE_SLUGS,
  ROLE_PERMISSIONS,
  ROLE_SLUGS,
  ROLE_WEIGHT,
  type Permission as PermSlug,
  type RoleSlug,
} from '../constants/rbac.js';
import type { Database } from '../shared/database/client.js';

const ROLE_NAMES: Record<RoleSlug, string> = {
  [ROLE_SLUGS.OWNER]: 'Owner',
  [ROLE_SLUGS.ADMIN]: 'Admin',
  [ROLE_SLUGS.MEMBER]: 'Member',
  [ROLE_SLUGS.VIEWER]: 'Viewer',
};

const ROLE_DESCRIPTIONS: Record<RoleSlug, string> = {
  [ROLE_SLUGS.OWNER]: 'Workspace owner — full control including billing and deletion',
  [ROLE_SLUGS.ADMIN]: 'Workspace admin — manage members and content',
  [ROLE_SLUGS.MEMBER]: 'Standard member — read/write content, no admin actions',
  [ROLE_SLUGS.VIEWER]: 'Read-only access',
};

async function seedRolesAndPermissions(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    const permissionRows = await Promise.all(
      ALL_PERMISSIONS.map(async (slug) => {
        const existing = await tx.select().from(permissions).where(eq(permissions.slug, slug)).limit(1);
        if (existing.length > 0) return existing[0]!;
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

    const roleRows = await Promise.all(
      ALL_ROLE_SLUGS.map(async (slug) => {
        const existing = await tx.select().from(roles).where(eq(roles.slug, slug)).limit(1);
        if (existing.length > 0) return existing[0]!;
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

const KEY_PREFIX = 'eiq_live_';

function generatePlaintextKey(): string {
  return `${KEY_PREFIX}${randomBytes(20).toString('hex')}`;
}

function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

const SEED_KEYS = [
  { name: 'Development', scope: 'events.write' },
  { name: 'Staging',     scope: 'events.write,events.read' },
];

async function seedApiKeys(db: Database): Promise<void> {
  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) {
    console.log('[seed:api-keys] No workspace found — skipping.');
    return;
  }

  console.log(`[seed:api-keys] Seeding keys for workspace "${workspace.name}" (${workspace.id})`);

  for (const def of SEED_KEYS) {
    const existing = await db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.workspaceId, workspace.id),
          eq(apiKeys.name, def.name),
          isNull(apiKeys.revokedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      console.log(`[seed:api-keys]   "${def.name}" already exists — skipping.`);
      continue;
    }

    const plaintext = generatePlaintextKey();
    const keyHash   = hashKey(plaintext);
    const keyPrefix = plaintext.slice(0, 12);

    await db.insert(apiKeys).values({
      workspaceId: workspace.id,
      name:        def.name,
      keyHash,
      keyPrefix,
      scope:       def.scope,
      isActive:    true,
      rateLimit:   0,
    });

    console.log(`[seed:api-keys]   ✓ "${def.name}"`);
    console.log(`[seed:api-keys]     key = ${plaintext}`);
  }
}

async function main(): Promise<void> {
  const { db, client } = createDb();
  try {
    console.log('[seed] Seeding roles and permissions...');
    await seedRolesAndPermissions(db);

    console.log('[seed] Seeding API keys...');
    await seedApiKeys(db);

    console.log('[seed] Done.');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});

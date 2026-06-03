/**
 * Seeds sample API keys for development.
 *
 * - Finds the first workspace in the DB (or skips if none exist).
 * - Creates two keys: one active "Development" key, one "Staging" key.
 * - Idempotent: skips creation if a key with the same name already exists
 *   for that workspace.
 *
 * The plaintext keys are printed to stdout so you can copy them into
 * your .env or SDK config. They are NOT stored in plaintext — only the
 * SHA-256 hash is persisted.
 */
import { createHash, randomBytes } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { workspaces } from '../../src/shared/database/schema/workspaces.js';
import { apiKeys } from '../../src/shared/database/schema/api-keys.js';
import type { Database } from '../../src/shared/database/client.js';

const KEY_PREFIX = 'eiq_live_';

function generatePlaintextKey(): string {
  return `${KEY_PREFIX}${randomBytes(20).toString('hex')}`;
}

function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

interface SeedKeyDef {
  name: string;
  scope: string;
}

const SEED_KEYS: SeedKeyDef[] = [
  { name: 'Development',  scope: 'events.write' },
  { name: 'Staging',      scope: 'events.write,events.read' },
];

export async function seedApiKeys(db: Database): Promise<void> {
  // Resolve first workspace
  const [workspace] = await db.select().from(workspaces).limit(1);
  if (!workspace) {
    console.log('[seed:api-keys] No workspace found — skipping. Create a workspace first.');
    return;
  }

  console.log(`[seed:api-keys] Seeding keys for workspace "${workspace.name}" (${workspace.id})`);

  for (const def of SEED_KEYS) {
    // Check if a non-revoked key with this name already exists
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

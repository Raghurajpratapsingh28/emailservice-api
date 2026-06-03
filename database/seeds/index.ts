/**
 * Entry point for seeding. Run via `npm run db:seed`.
 */
import { createDb } from '../../src/shared/database/client.js';
import { seedRolesAndPermissions } from './roles-permissions.js';
import { seedApiKeys } from './api-keys.js';

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
  // eslint-disable-next-line no-console
  console.error('[seed] Failed:', err);
  process.exit(1);
});

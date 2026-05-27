import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from '../shared/database/client.js';

const { db, client } = createDb();
try {
  console.log('[migrate] running migrations...');
  await migrate(db, { migrationsFolder: './database/migrations' });
  console.log('[migrate] done.');
} finally {
  await client.end({ timeout: 5 });
}

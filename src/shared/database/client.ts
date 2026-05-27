import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from '@config/index.js';
import * as schema from './schema/index.js';

/**
 * Drizzle DB client. Wrapping `postgres` for connection pooling.
 *
 * Connection lifecycle is managed by `database.plugin`. Application code
 * should depend on `app.db` (the Fastify-decorated handle), not on this module
 * directly, except for migration scripts and seeders.
 */

export type Database = ReturnType<typeof createDb>['db'];
export type DatabaseClient = ReturnType<typeof createDb>['client'];

export interface CreateDbOptions {
  url?: string;
  max?: number;
  idleTimeout?: number;
  connectTimeout?: number;
  ssl?: boolean;
  /** Lifetime cap for prepared statement names; null disables. */
  prepare?: boolean;
}

export function createDb(opts: CreateDbOptions = {}) {
  const url = opts.url ?? config.DATABASE_URL;
  const client = postgres(url, {
    max: opts.max ?? config.DATABASE_POOL_MAX,
    idle_timeout: opts.idleTimeout ?? config.DATABASE_IDLE_TIMEOUT_S,
    connect_timeout: opts.connectTimeout ?? config.DATABASE_CONNECT_TIMEOUT_S,
    ssl: (opts.ssl ?? config.DATABASE_SSL) ? 'require' : false,
    prepare: opts.prepare ?? true,
    onnotice: () => undefined, // suppress NOTICE logs in production
  });

  const db = drizzle(client, { schema, casing: 'snake_case' });
  return { db, client };
}

export { schema };

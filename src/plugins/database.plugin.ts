import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createDb, type Database, type DatabaseClient } from '@shared/database/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    dbClient: DatabaseClient;
  }
}

/**
 * Decorates Fastify with `app.db` (Drizzle) and `app.dbClient` (postgres handle),
 * and closes the underlying pool on app shutdown.
 */
export default fp(
  async function databasePlugin(app: FastifyInstance) {
    const { db, client } = createDb();

    app.decorate('db', db);
    app.decorate('dbClient', client);

    app.addHook('onClose', async () => {
      app.log.info('[database] Closing connection pool');
      await client.end({ timeout: 5 });
    });
  },
  { name: 'database-plugin' },
);

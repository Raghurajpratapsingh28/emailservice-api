/**
 * Integration test harness. Builds the Fastify app against real Postgres + Redis + NATS,
 * runs migrations, seeds RBAC, and exposes per-test helpers.
 *
 * Skip-by-default: if any infra component is unreachable, tests in this dir are skipped
 * with a console warning rather than failing CI.
 */
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import IORedis from 'ioredis';
import { connect } from 'nats';
import { config } from '@config/index.js';
import { createDb } from '@shared/database/client.js';
import { seedRolesAndPermissions } from '../../../database/seeds/roles-permissions.js';
import { buildApp } from '@app/app.js';
import type { FastifyInstance } from 'fastify';

export async function checkInfraAvailable(): Promise<{ ok: boolean; reason?: string }> {
  // Postgres
  try {
    const { client } = createDb();
    await client`SELECT 1`;
    await client.end({ timeout: 5 });
  } catch (err) {
    return { ok: false, reason: `postgres: ${(err as Error).message}` };
  }

  // Redis
  try {
    const r = new IORedis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await r.connect();
    await r.ping();
    await r.quit();
  } catch (err) {
    return { ok: false, reason: `redis: ${(err as Error).message}` };
  }

  // NATS
  try {
    const nc = await connect({ servers: config.NATS_URL, reconnect: false, timeout: 1500 });
    await nc.drain();
  } catch (err) {
    return { ok: false, reason: `nats: ${(err as Error).message}` };
  }

  return { ok: true };
}

export async function resetDatabase(): Promise<void> {
  const { db, client } = createDb();
  try {
    // Truncate every table created by our schemas. Order doesn't matter with CASCADE.
    await db.execute(sql`
      TRUNCATE TABLE
        invoices,
        usage_counters,
        billing_events,
        subscriptions,
        workflow_executions,
        workflows,
        segment_memberships,
        contact_tags,
        contacts,
        segments,
        audit_logs,
        invites,
        email_verification_tokens,
        password_reset_tokens,
        refresh_tokens,
        workspace_members,
        role_permissions,
        permissions,
        roles,
        workspaces,
        users
      RESTART IDENTITY CASCADE
    `);
  } finally {
    await client.end({ timeout: 5 });
  }
}

export async function runMigrations(): Promise<void> {
  const { db, client } = createDb();
  try {
    await migrate(db, { migrationsFolder: './database/migrations' });
  } finally {
    await client.end({ timeout: 5 });
  }
}

export async function reseedRbac(): Promise<void> {
  const { db, client } = createDb();
  try {
    await seedRolesAndPermissions(db);
  } finally {
    await client.end({ timeout: 5 });
  }
}

export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({
    fastifyOptions: {
      logger: false,
      trustProxy: true,
    },
  });
  await app.ready();
  return app;
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  checkInfraAvailable,
  reseedRbac,
  resetDatabase,
  runMigrations,
} from './helpers/app.js';
import type { FastifyInstance } from 'fastify';

const infra = await checkInfraAvailable();
const describeIfInfra = infra.ok ? describe : describe.skip;

describeIfInfra('event ingestion — integration', () => {
  let app: FastifyInstance;
  const natsCapture: Array<{ subject: string; payload: unknown }> = [];

  beforeAll(async () => {
    await runMigrations();
    await reseedRbac();
    app = await buildTestApp();

    const original = app.nats.publish.bind(app.nats);
    app.nats.publish = ((subject: string, payload: unknown) => {
      natsCapture.push({ subject, payload });
      return original(subject, payload);
    }) as typeof app.nats.publish;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    natsCapture.length = 0;
    await resetDatabase();
    await reseedRbac();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  async function signupOwner(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email, password: 'GoodPass!2345A' },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as {
      user: { id: string };
      workspace: { id: string };
      tokens: { accessToken: string };
    };
  }

  async function seedApiKey(workspaceId: string, opts: { isActive?: boolean; scope?: string } = {}) {
    const { apiKeys } = await import('@shared/database/schema/api-keys.js');
    const { sha256 } = await import('@shared/utils/crypto.js');
    const plaintext = `wk_live_test_${Math.random().toString(36).slice(2)}`;
    await app.db.insert(apiKeys).values({
      workspaceId,
      name: 'Test Key',
      keyHash: sha256(plaintext),
      keyPrefix: plaintext.slice(0, 12),
      scope: opts.scope ?? 'events.write',
      isActive: opts.isActive ?? true,
    });
    return plaintext;
  }

  // ─── 1. Track happy path + locked queue contract ─────────────────────────

  it('track: accepts event and publishes locked queue contract', async () => {
    const u = await signupOwner('o1@example.com');
    const key = await seedApiKey(u.workspace.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/track',
      headers: { 'x-write-key': key },
      payload: {
        userId: 'user_123',
        anonymousId: 'anon_abc',
        event: 'Trial Upgraded',
        properties: { plan_from: 'free', plan_to: 'pro' },
        context: { ip: '1.2.3.4' },
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.messageId).toMatch(/^[0-9a-f-]{36}$/i);

    // Verify locked queue contract
    const queued = natsCapture.find((c) => c.subject.startsWith('events.raw.'));
    expect(queued).toBeDefined();
    expect(queued!.subject).toBe(`events.raw.${u.workspace.id}`);
    const payload = queued!.payload as Record<string, unknown>;
    expect(payload.eventId).toBe(body.messageId);
    expect(payload.workspaceId).toBe(u.workspace.id);
    expect(payload.eventType).toBe('track');
    expect(payload.eventName).toBe('Trial Upgraded');
    expect(payload.userId).toBe('user_123');
    expect(payload.anonymousId).toBe('anon_abc');
    expect(payload.groupId).toBeNull();
    expect(payload.properties).toMatchObject({ plan_from: 'free', plan_to: 'pro' });
    expect(payload.receivedAt).toBeTruthy();
  });

  // ─── 2. Identify ─────────────────────────────────────────────────────────

  it('identify: accepts and publishes with eventType=identify', async () => {
    const u = await signupOwner('o2@example.com');
    const key = await seedApiKey(u.workspace.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/identify',
      headers: { 'x-write-key': key },
      payload: { userId: 'u1', traits: { email: 'a@b.com', plan: 'pro' } },
    });
    expect(res.statusCode).toBe(202);
    const queued = natsCapture.find((c) => c.subject.startsWith('events.raw.'));
    expect((queued!.payload as Record<string, unknown>).eventType).toBe('identify');
    expect((queued!.payload as Record<string, unknown>).traits).toMatchObject({ email: 'a@b.com' });
  });

  // ─── 3. Page normalization ────────────────────────────────────────────────

  it('page: normalizes eventName to "Page Viewed"', async () => {
    const u = await signupOwner('o3@example.com');
    const key = await seedApiKey(u.workspace.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/page',
      headers: { 'x-write-key': key },
      payload: { userId: 'u1', name: 'Pricing', properties: { section: 'annual' } },
    });
    expect(res.statusCode).toBe(202);
    const queued = natsCapture.find((c) => c.subject.startsWith('events.raw.'));
    expect((queued!.payload as Record<string, unknown>).eventName).toBe('Page Viewed');
    expect((queued!.payload as Record<string, unknown>).eventType).toBe('page');
  });

  // ─── 4. Group ────────────────────────────────────────────────────────────

  it('group: publishes with groupId', async () => {
    const u = await signupOwner('o4@example.com');
    const key = await seedApiKey(u.workspace.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group',
      headers: { 'x-write-key': key },
      payload: { userId: 'u1', groupId: 'company_abc', traits: { name: 'Acme' } },
    });
    expect(res.statusCode).toBe(202);
    const queued = natsCapture.find((c) => c.subject.startsWith('events.raw.'));
    expect((queued!.payload as Record<string, unknown>).groupId).toBe('company_abc');
  });

  // ─── 5. Alias ────────────────────────────────────────────────────────────

  it('alias: maps previousId to anonymousId in payload', async () => {
    const u = await signupOwner('o5@example.com');
    const key = await seedApiKey(u.workspace.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/alias',
      headers: { 'x-write-key': key },
      payload: { previousId: 'anon_abc', userId: 'user_123' },
    });
    expect(res.statusCode).toBe(202);
    const queued = natsCapture.find((c) => c.subject.startsWith('events.raw.'));
    const p = queued!.payload as Record<string, unknown>;
    expect(p.eventType).toBe('alias');
    expect(p.userId).toBe('user_123');
    expect(p.anonymousId).toBe('anon_abc');
  });

  // ─── 6. Invalid write key ─────────────────────────────────────────────────

  it('rejects missing write key with 401 INVALID_WRITE_KEY', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/track',
      payload: { userId: 'u1', event: 'X' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_WRITE_KEY');
  });

  it('rejects unknown write key with 401 INVALID_WRITE_KEY', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/track',
      headers: { 'x-write-key': 'wk_live_bogus' },
      payload: { userId: 'u1', event: 'X' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_WRITE_KEY');
  });

  // ─── 7. Inactive workspace ────────────────────────────────────────────────

  it('rejects when workspace is inactive', async () => {
    const u = await signupOwner('o7@example.com');
    const key = await seedApiKey(u.workspace.id);

    // Deactivate workspace
    const { workspaces } = await import('@shared/database/schema/workspaces.js');
    const { eq } = await import('drizzle-orm');
    await app.db
      .update(workspaces)
      .set({ status: 'inactive' })
      .where(eq(workspaces.id, u.workspace.id));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/track',
      headers: { 'x-write-key': key },
      payload: { userId: 'u1', event: 'X' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('WORKSPACE_INACTIVE');
  });

  // ─── 8. Oversized payload ─────────────────────────────────────────────────

  it('rejects payload exceeding 32KB', async () => {
    const u = await signupOwner('o8@example.com');
    const key = await seedApiKey(u.workspace.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/track',
      headers: { 'x-write-key': key },
      payload: {
        userId: 'u1',
        event: 'X',
        properties: { data: 'x'.repeat(33 * 1024) },
      },
    });
    // Either 500 (InternalServerError from assertPayloadSize) or 413 from Fastify bodyLimit
    expect([400, 413, 500]).toContain(res.statusCode);
  });

  // ─── 9. Soft schema violation ─────────────────────────────────────────────

  it('soft schema violation: accepts event but marks status=schema_violation', async () => {
    const u = await signupOwner('o9@example.com');
    const key = await seedApiKey(u.workspace.id);

    // Seed a schema requiring 'plan' field
    const { eventSchemas } = await import('@shared/database/schema/events.js');
    await app.db.insert(eventSchemas).values({
      workspaceId: u.workspace.id,
      eventName: 'Trial Upgraded',
      schemaDefinition: { required: ['plan'], properties: { plan: { type: 'string' } } },
      validationMode: 'soft',
      isActive: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/track',
      headers: { 'x-write-key': key },
      payload: { userId: 'u1', event: 'Trial Upgraded', properties: {} }, // missing 'plan'
    });
    expect(res.statusCode).toBe(202); // accepted despite violation

    // Row should be in DB with status=schema_violation
    const { eventsRaw } = await import('@shared/database/schema/events.js');
    const { eq } = await import('drizzle-orm');
    const rows = await app.db
      .select()
      .from(eventsRaw)
      .where(eq(eventsRaw.workspaceId, u.workspace.id));
    expect(rows[0]?.status).toBe('schema_violation');
  });

  // ─── 10. Hard schema violation ────────────────────────────────────────────

  it('hard schema violation: rejects event with 400', async () => {
    const u = await signupOwner('o10@example.com');
    const key = await seedApiKey(u.workspace.id);

    const { eventSchemas } = await import('@shared/database/schema/events.js');
    await app.db.insert(eventSchemas).values({
      workspaceId: u.workspace.id,
      eventName: 'Purchase',
      schemaDefinition: { required: ['amount'], properties: { amount: { type: 'number' } } },
      validationMode: 'hard',
      isActive: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/track',
      headers: { 'x-write-key': key },
      payload: { userId: 'u1', event: 'Purchase', properties: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  // ─── 11. Tenant isolation ─────────────────────────────────────────────────

  it('tenant isolation: key from workspace A cannot ingest into workspace B', async () => {
    const a = await signupOwner('a@example.com');
    const b = await signupOwner('b@example.com');
    const keyA = await seedApiKey(a.workspace.id);

    // Use key A but the event should land in workspace A, not B
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/track',
      headers: { 'x-write-key': keyA },
      payload: { userId: 'u1', event: 'X' },
    });
    expect(res.statusCode).toBe(202);

    const { eventsRaw } = await import('@shared/database/schema/events.js');
    const { eq } = await import('drizzle-orm');
    const inB = await app.db
      .select()
      .from(eventsRaw)
      .where(eq(eventsRaw.workspaceId, b.workspace.id));
    expect(inB).toHaveLength(0);
  });

  // ─── 12. Queue publish failure rollback ───────────────────────────────────

  it('queue publish failure rolls back the event row', async () => {
    const u = await signupOwner('o12@example.com');
    const key = await seedApiKey(u.workspace.id);

    const original = app.nats.publish.bind(app.nats);
    app.nats.publish = (() => {
      throw new Error('NATS down');
    }) as typeof app.nats.publish;
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/track',
        headers: { 'x-write-key': key },
        payload: { userId: 'u1', event: 'X' },
      });
      expect(res.statusCode).toBe(500);
    } finally {
      app.nats.publish = original;
    }

    const { eventsRaw } = await import('@shared/database/schema/events.js');
    const { eq } = await import('drizzle-orm');
    const rows = await app.db
      .select()
      .from(eventsRaw)
      .where(eq(eventsRaw.workspaceId, u.workspace.id));
    expect(rows).toHaveLength(0);
  });

  // ─── 13. Debug endpoints ──────────────────────────────────────────────────

  it('debug endpoint returns recent events for the key workspace', async () => {
    const u = await signupOwner('o13@example.com');
    const key = await seedApiKey(u.workspace.id);

    await app.inject({
      method: 'POST',
      url: '/api/v1/track',
      headers: { 'x-write-key': key },
      payload: { userId: 'u1', event: 'X' },
    });

    const debug = await app.inject({
      method: 'GET',
      url: '/api/v1/events/debug',
      headers: { 'x-write-key': key },
    });
    expect(debug.statusCode).toBe(200);
    expect(debug.json().events).toHaveLength(1);
  });

  // ─── 14. Authorization header fallback ───────────────────────────────────

  it('accepts write key via Authorization: Bearer header', async () => {
    const u = await signupOwner('o14@example.com');
    const key = await seedApiKey(u.workspace.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/track',
      headers: { authorization: `Bearer ${key}` },
      payload: { userId: 'u1', event: 'X' },
    });
    expect(res.statusCode).toBe(202);
  });
});

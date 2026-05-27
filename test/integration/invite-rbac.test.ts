import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  buildTestApp,
  checkInfraAvailable,
  reseedRbac,
  resetDatabase,
  runMigrations,
} from './helpers/app.js';
import { invites } from '@shared/database/schema/index.js';
import { sha256 } from '@shared/utils/crypto.js';
import { hashOpaqueToken } from '@shared/utils/tokens.js';
import type { FastifyInstance } from 'fastify';

const infra = await checkInfraAvailable();
const describeIfInfra = infra.ok ? describe : describe.skip;

describeIfInfra('invite + RBAC — integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await runMigrations();
    await reseedRbac();
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await reseedRbac();
  });

  async function signup(email: string, password = 'GoodPass!2345A') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email, password },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as {
      user: { id: string; email: string };
      workspace: { id: string };
      tokens: { accessToken: string; refreshToken: string };
    };
  }

  it('owner can invite, viewer cannot', async () => {
    const owner = await signup('owner@example.com');

    // Owner invite — succeeds
    const ownerInvite = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invites',
      headers: {
        authorization: `Bearer ${owner.tokens.accessToken}`,
        'x-workspace-id': owner.workspace.id,
      },
      payload: { email: 'invitee@example.com', role: 'member' },
    });
    expect(ownerInvite.statusCode).toBe(201);
    const inviteId: string = ownerInvite.json().inviteId;
    expect(inviteId).toBeDefined();

    // Accept invite (issuing the same plaintext via DB write, since we don't have email)
    const knownPlaintext = 'TEST_INVITE_TOKEN_' + 'y'.repeat(40);
    await app.db
      .update(invites)
      .set({ tokenHash: sha256(knownPlaintext) })
      .where(eq(invites.id, inviteId));

    const acceptRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      payload: {
        token: knownPlaintext,
        password: 'GoodPass!2345A',
        firstName: 'Bob',
      },
    });
    expect(acceptRes.statusCode).toBe(200);
    const accepted = acceptRes.json();
    expect(accepted.workspaceId).toBe(owner.workspace.id);
    const memberAccess: string = accepted.tokens.accessToken;

    // Member cannot invite (lacks workspace.members.write)
    const memberInvite = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invites',
      headers: {
        authorization: `Bearer ${memberAccess}`,
        'x-workspace-id': owner.workspace.id,
      },
      payload: { email: 'extra@example.com', role: 'viewer' },
    });
    expect(memberInvite.statusCode).toBe(403);
    expect(memberInvite.json().error.code).toBe('PERMISSION_DENIED');

    // Sanity: invite row marked accepted
    const inviteRow = await app.db.select().from(invites).where(eq(invites.id, inviteId));
    expect(inviteRow[0]?.acceptedAt).not.toBeNull();
    expect(inviteRow[0]?.tokenHash).toBe(hashOpaqueToken(knownPlaintext));
  });

  it('rejects requests without a workspace context for workspace-scoped routes', async () => {
    const owner = await signup('owner2@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invites',
      headers: { authorization: `Bearer ${owner.tokens.accessToken}` },
      payload: { email: 'x@example.com', role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('WORKSPACE_ACCESS_DENIED');
  });

  it('rejects access to /me without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});

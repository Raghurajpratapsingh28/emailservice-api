import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  buildTestApp,
  checkInfraAvailable,
  reseedRbac,
  resetDatabase,
  runMigrations,
} from './helpers/app.js';
import { passwordResetTokens, users } from '@shared/database/schema/index.js';
import { hashOpaqueToken } from '@shared/utils/tokens.js';
import { sha256 } from '@shared/utils/crypto.js';
import type { FastifyInstance } from 'fastify';

const infra = await checkInfraAvailable();
const describeIfInfra = infra.ok ? describe : describe.skip;

/**
 * The plaintext token is sent to the user via email; in tests we don't have an inbox,
 * so we look up the *latest unconsumed* row for the user and brute-search by hash.
 *
 * Strategy: we attempt up to N candidate tokens generated locally. Instead, the
 * pragmatic approach is to invert via lookup: we know the user id, so we query the
 * latest token row, then we *can't* recover the plaintext — so we expose a helper that
 * the test asks the auth service to issue a known plaintext directly.
 *
 * For the integration test below we directly write a test reset token (with a known
 * plaintext) into the DB after the forgot-password call, simulating "we know the link".
 */

describeIfInfra('forgot/reset password — integration', () => {
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

  it('forgot-password returns 202 even when email is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ghost@example.com' },
    });
    expect(res.statusCode).toBe(202);
  });

  it('reset-password completes and revokes all sessions', async () => {
    // 1. Sign up
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'reset@example.com', password: 'GoodPass!2345A' },
    });
    expect(signupRes.statusCode).toBe(201);
    const signup = signupRes.json();
    const userId: string = signup.user.id;
    const oldRefresh: string = signup.tokens.refreshToken;

    // 2. Issue a reset token directly via DB so we know the plaintext.
    const knownPlaintext = 'TEST_RESET_TOKEN_' + 'x'.repeat(40);
    const tokenHash = sha256(knownPlaintext);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await app.db.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });

    // 3. Reset
    const resetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: knownPlaintext, password: 'NewSecure!Pass234' },
    });
    expect(resetRes.statusCode).toBe(200);

    // 4. Old refresh token should be revoked
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(refreshRes.statusCode).toBe(401);

    // 5. Old password fails, new password works
    const oldPwdLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'reset@example.com', password: 'GoodPass!2345A' },
    });
    expect(oldPwdLogin.statusCode).toBe(401);

    const newPwdLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'reset@example.com', password: 'NewSecure!Pass234' },
    });
    expect(newPwdLogin.statusCode).toBe(200);

    // 6. The reset token is single-use
    const reuseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: knownPlaintext, password: 'AnotherNew!Pass234' },
    });
    expect(reuseRes.statusCode).toBe(401);

    // Sanity: the reset token row is consumed
    const tokenRows = await app.db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashOpaqueToken(knownPlaintext)));
    expect(tokenRows[0]?.consumedAt).not.toBeNull();
    expect(users).toBeDefined(); // suppress unused import in some configs
  });
});

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
const describeIfInfra = infra.ok
  ? describe
  : describe.skip.bind(describe, '(skipped: infra unavailable — ' + infra.reason + ')');

describeIfInfra('auth flow — integration', () => {
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

  it('signs up, logs in, calls /me, refreshes, logs out', async () => {
    const signupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: {
        email: 'alice@example.com',
        password: 'GoodPass!2345A',
        firstName: 'Alice',
      },
    });
    expect(signupRes.statusCode).toBe(201);
    const signup = signupRes.json();
    expect(signup.user.email).toBe('alice@example.com');
    expect(signup.workspace.id).toBeDefined();
    expect(signup.tokens.accessToken).toBeTruthy();
    expect(signup.tokens.refreshToken).toBeTruthy();

    // Login with same credentials
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'alice@example.com', password: 'GoodPass!2345A' },
    });
    expect(loginRes.statusCode).toBe(200);
    const login = loginRes.json();

    // /me with bearer
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().email).toBe('alice@example.com');

    // Refresh
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: login.refreshToken },
    });
    expect(refreshRes.statusCode).toBe(200);
    const refreshed = refreshRes.json();
    expect(refreshed.refreshToken).not.toBe(login.refreshToken);

    // Old refresh token should now be unusable (and trigger family revoke)
    const reuseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: login.refreshToken },
    });
    expect(reuseRes.statusCode).toBe(401);
    expect(reuseRes.json().error.code).toBe('TOKEN_REUSE');

    // After family revoke, the *new* refresh token issued mid-flight is also revoked
    const afterCompromise = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: refreshed.refreshToken },
    });
    expect(afterCompromise.statusCode).toBe(401);
  });

  it('rejects login on wrong password', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { email: 'b@example.com', password: 'GoodPass!2345A' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'b@example.com', password: 'WrongPass!2345A' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('does not enumerate users on login or forgot-password', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'WhateverPass!2345A' },
    });
    expect(loginRes.statusCode).toBe(401);
    expect(loginRes.json().error.code).toBe('INVALID_CREDENTIALS');

    const forgotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'nobody@example.com' },
    });
    expect(forgotRes.statusCode).toBe(202);
  });
});

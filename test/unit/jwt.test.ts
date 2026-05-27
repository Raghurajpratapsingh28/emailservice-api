import { describe, expect, it } from 'vitest';
import {
  JwtErrors,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '@shared/utils/jwt.js';

describe('shared/utils/jwt', () => {
  it('signs and verifies an access token', () => {
    const token = signAccessToken({ sub: 'user-1', email: 'a@b.c' });
    const claims = verifyAccessToken(token);
    expect(claims.sub).toBe('user-1');
    expect(claims.email).toBe('a@b.c');
    expect(claims.type).toBe('access');
    expect(claims.iss).toBeDefined();
    expect(claims.aud).toBeDefined();
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('signs and verifies a refresh token', () => {
    const token = signRefreshToken({ sub: 'user-1', jti: 'jti-1' });
    const claims = verifyRefreshToken(token);
    expect(claims.sub).toBe('user-1');
    expect(claims.jti).toBe('jti-1');
    expect(claims.type).toBe('refresh');
  });

  it('rejects access token presented as refresh', () => {
    const token = signAccessToken({ sub: 'user-1', email: 'a@b.c' });
    expect(() => verifyRefreshToken(token)).toThrow(JwtErrors.JsonWebTokenError);
  });

  it('rejects tampered tokens', () => {
    const token = signAccessToken({ sub: 'user-1', email: 'a@b.c' });
    const tampered = token.slice(0, -2) + 'aa';
    expect(() => verifyAccessToken(tampered)).toThrow(JwtErrors.JsonWebTokenError);
  });
});

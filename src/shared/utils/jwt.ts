import jwt, {
  type JwtPayload,
  type SignOptions,
  type VerifyOptions,
} from 'jsonwebtoken';
import { config } from '@config/index.js';
import { parseDurationToSeconds } from './time.js';

/**
 * NOTE: We use the `@fastify/jwt` plugin for request-bound JWT helpers, but for
 * server-side token issuance/verification (refresh tokens, internal tokens) we
 * use this thin wrapper around `jsonwebtoken` for explicit control.
 *
 * Access tokens: signed with JWT_ACCESS_SECRET, short-lived.
 * Refresh tokens (when JWT-shaped): signed with JWT_REFRESH_SECRET. We additionally
 * persist a hashed refresh token for revocation.
 */

export interface AccessTokenClaims extends JwtPayload {
  sub: string; // user id
  email: string;
  type: 'access';
  /** Currently active workspace id, optional (set when a workspace is selected). */
  ws?: string;
  /** JWT id; allows revocation lists if needed. */
  jti?: string;
}

export interface RefreshTokenClaims extends JwtPayload {
  sub: string; // user id
  type: 'refresh';
  /** Refresh token id (matches refresh_tokens.id). Critical for rotation. */
  jti: string;
  /** Optional family id for refresh-reuse detection. */
  fid?: string;
}

const baseSignOpts: SignOptions = {
  algorithm: 'HS256',
  issuer: config.JWT_ISSUER,
  audience: config.JWT_AUDIENCE,
};

const baseVerifyOpts: VerifyOptions = {
  algorithms: ['HS256'],
  issuer: config.JWT_ISSUER,
  audience: config.JWT_AUDIENCE,
};

export function signAccessToken(
  claims: Omit<AccessTokenClaims, 'type' | 'iat' | 'exp' | 'iss' | 'aud'>,
): string {
  return jwt.sign({ ...claims, type: 'access' }, config.JWT_ACCESS_SECRET, {
    ...baseSignOpts,
    expiresIn: parseDurationToSeconds(config.JWT_ACCESS_TTL),
  });
}

export function signRefreshToken(
  claims: Omit<RefreshTokenClaims, 'type' | 'iat' | 'exp' | 'iss' | 'aud'>,
): string {
  return jwt.sign({ ...claims, type: 'refresh' }, config.JWT_REFRESH_SECRET, {
    ...baseSignOpts,
    expiresIn: parseDurationToSeconds(config.JWT_REFRESH_TTL),
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, baseVerifyOpts);
  if (typeof decoded !== 'object' || decoded === null) {
    throw new jwt.JsonWebTokenError('Invalid token payload');
  }
  const payload = decoded as JwtPayload & { type?: string };
  if (payload.type !== 'access') {
    throw new jwt.JsonWebTokenError('Invalid token type');
  }
  return payload as AccessTokenClaims;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const decoded = jwt.verify(token, config.JWT_REFRESH_SECRET, baseVerifyOpts);
  if (typeof decoded !== 'object' || decoded === null) {
    throw new jwt.JsonWebTokenError('Invalid token payload');
  }
  const payload = decoded as JwtPayload & { type?: string };
  if (payload.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('Invalid token type');
  }
  return payload as RefreshTokenClaims;
}

export const JwtErrors = {
  TokenExpiredError: jwt.TokenExpiredError,
  JsonWebTokenError: jwt.JsonWebTokenError,
  NotBeforeError: jwt.NotBeforeError,
};

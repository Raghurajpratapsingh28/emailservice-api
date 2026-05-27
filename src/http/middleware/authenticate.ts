import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { UnauthorizedError } from '@shared/errors/app-errors.js';
import { users } from '@shared/database/schema/users.js';
import type { AuthenticatedUser } from '@shared/types/index.js';

/**
 * `request.user` is owned by `@fastify/jwt` (decoded payload). We attach the
 * DB-hydrated user on a separate slot, `request.authedUser`.
 *
 * Hardening (F3):
 *  - JWT `jti` is checked against the Redis denylist on every request → logout
 *    revokes access tokens immediately (no 15-minute window).
 *  - JWT `iat` is checked against `users.passwordChangedAt` → password reset
 *    or any password change kills every still-valid access token globally,
 *    in one DB read we already do.
 */
declare module 'fastify' {
  interface FastifyRequest {
    authedUser?: AuthenticatedUser;
    accessJti?: string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      email: string;
      type: 'access';
      ws?: string;
      jti?: string;
      iat?: number;
    };
    user: {
      sub: string;
      email: string;
      type: 'access';
      ws?: string;
      jti?: string;
      iat?: number;
    };
  }
}

export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await req.jwtVerify();
  } catch {
    throw new UnauthorizedError('Invalid or expired access token', 'TOKEN_INVALID');
  }

  const payload = req.user;
  if (!payload?.sub || payload.type !== 'access' || !payload.iat) {
    throw new UnauthorizedError('Invalid token', 'TOKEN_INVALID');
  }

  // Denylist check (F3).
  if (payload.jti) {
    const revoked = await req.server.services.jtiDenylist.isRevoked(payload.jti);
    if (revoked) {
      throw new UnauthorizedError('Token has been revoked', 'TOKEN_REVOKED');
    }
  }

  // Hydrate from DB to verify isActive and to enforce iat-vs-passwordChangedAt.
  const rows = await req.server.db
    .select({
      id: users.id,
      email: users.email,
      isEmailVerified: users.isEmailVerified,
      isActive: users.isActive,
      passwordChangedAt: users.passwordChangedAt,
    })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);

  const u = rows[0];
  if (!u || !u.isActive) {
    throw new UnauthorizedError('User no longer active', 'ACCOUNT_DISABLED');
  }

  // iat is in seconds. passwordChangedAt is ms. Compare in seconds with 1s slack.
  const iatSec = payload.iat;
  const pwdChangedSec = Math.floor(u.passwordChangedAt.getTime() / 1000);
  if (iatSec + 1 < pwdChangedSec) {
    throw new UnauthorizedError(
      'Token issued before last password change',
      'TOKEN_STALE',
    );
  }

  req.authedUser = {
    id: u.id,
    email: u.email,
    isEmailVerified: u.isEmailVerified,
    isActive: u.isActive,
  };
  req.accessJti = payload.jti;
}

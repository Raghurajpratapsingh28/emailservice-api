import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '@config/index.js';
import { UnauthorizedError } from '@shared/errors/app-errors.js';
import { timingSafeEqualString } from '@shared/utils/crypto.js';

/**
 * Internal service-to-service auth via shared API key. Used for endpoints invoked
 * by trusted internal workers (e.g. transactional-service, billing webhooks).
 *
 * The key is presented via `x-internal-key` header (chosen instead of Authorization
 * to avoid colliding with user JWTs at intermediaries).
 */
export async function internalAuth(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const fromHeader = req.headers['x-internal-key'];
  const fromQuery = (req.query as Record<string, string | undefined>)['key'];
  const presented = typeof fromHeader === 'string' ? fromHeader : (fromQuery ?? '');

  if (!presented) {
    throw new UnauthorizedError('Missing internal credentials', 'INTERNAL_AUTH_REQUIRED');
  }
  if (!timingSafeEqualString(presented, config.INTERNAL_API_KEY)) {
    throw new UnauthorizedError('Invalid internal credentials', 'INTERNAL_AUTH_INVALID');
  }
}

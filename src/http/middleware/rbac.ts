import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import {
  ForbiddenError,
  PermissionDeniedError,
  UnauthorizedError,
} from '@shared/errors/app-errors.js';
import type { Permission, RoleSlug } from '@shared/types/index.js';

/**
 * Returns a preHandler that enforces ALL of the given permissions on the
 * authenticated user's active workspace context.
 *
 * Usage:
 *   { preHandler: [app.authenticate, app.workspaceGuard, requirePermissions('campaigns.write')] }
 */
export function requirePermissions(
  ...required: readonly Permission[]
): preHandlerHookHandler {
  return async function permissionGate(req: FastifyRequest, _reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError('Authentication required');
    }
    if (!req.workspace || !req.permissions) {
      throw new ForbiddenError('Workspace context required', 'WORKSPACE_REQUIRED');
    }
    const missing = required.filter((p) => !req.permissions!.has(p));
    if (missing.length > 0) {
      // Audit denial (best-effort)
      await req.server.services.audit
        .record({
          action: 'rbac.permission.denied',
          actorUserId: req.authedUser.id,
          workspaceId: req.workspace.id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          success: false,
          metadata: { required, missing },
        })
        .catch(() => undefined);
      throw new PermissionDeniedError(missing);
    }
  };
}

/**
 * Returns a preHandler that requires the membership role to be one of `allowed`.
 */
export function requireRole(...allowed: readonly RoleSlug[]): preHandlerHookHandler {
  return async function roleGate(req: FastifyRequest, _reply: FastifyReply) {
    if (!req.authedUser) {
      throw new UnauthorizedError('Authentication required');
    }
    if (!req.workspace) {
      throw new ForbiddenError('Workspace context required', 'WORKSPACE_REQUIRED');
    }
    if (!allowed.includes(req.workspace.role)) {
      throw new ForbiddenError('Insufficient role', 'INSUFFICIENT_ROLE');
    }
  };
}

/**
 * Requires that the authenticated user has verified their email.
 */
export async function requireVerifiedEmail(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!req.authedUser) {
    throw new UnauthorizedError('Authentication required');
  }
  if (!req.authedUser.isEmailVerified) {
    throw new ForbiddenError('Email verification required', 'EMAIL_NOT_VERIFIED');
  }
}

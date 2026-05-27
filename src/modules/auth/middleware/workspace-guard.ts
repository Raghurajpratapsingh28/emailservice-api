import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import {
  UnauthorizedError,
  ValidationError,
  WorkspaceAccessDeniedError,
} from '@shared/errors/app-errors.js';
import { workspaces } from '@shared/database/schema/workspaces.js';
import type { Permission, RoleSlug, WorkspaceContext } from '@shared/types/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    workspace?: WorkspaceContext;
    permissions?: Set<Permission>;
  }
}

const WORKSPACE_HEADER = 'x-workspace-id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads the workspace context for an authenticated request.
 *
 * Hardening (F8 — URL-leak vector):
 *   The previous implementation accepted the workspace id from query string and
 *   path params as fallbacks. Workspace ids in URLs end up in proxy logs,
 *   browser history, and Referer headers. We now accept ONLY the
 *   `x-workspace-id` header. Path-param `:workspaceId` is still recognised but
 *   only when the route was explicitly authored to use it (caller decides).
 *
 *   Query-string fallback is removed entirely.
 */
export async function workspaceGuard(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!req.authedUser) {
    throw new UnauthorizedError('Authentication required');
  }

  const headerValue = req.headers[WORKSPACE_HEADER];
  const fromHeader = typeof headerValue === 'string' ? headerValue.trim() : null;
  const params = req.params as Record<string, string | undefined> | undefined;
  const fromParam = params?.workspaceId?.trim();

  const workspaceId = fromHeader && fromHeader.length > 0 ? fromHeader : fromParam;
  if (!workspaceId) {
    throw new WorkspaceAccessDeniedError();
  }
  if (!UUID_RE.test(workspaceId)) {
    throw new ValidationError('Invalid workspace id', { field: 'x-workspace-id' });
  }

  const wsRows = await req.server.db
    .select({ id: workspaces.id, slug: workspaces.slug, plan: workspaces.plan })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .limit(1);
  const ws = wsRows[0];
  if (!ws) {
    throw new WorkspaceAccessDeniedError();
  }

  const membership = await req.server.services.rbac.getMembershipContext(
    ws.id,
    req.authedUser.id,
  );
  if (!membership) {
    throw new WorkspaceAccessDeniedError();
  }

  req.workspace = {
    id: ws.id,
    slug: ws.slug,
    plan: ws.plan,
    role: membership.role,
    membershipId: membership.membershipId,
  };
  req.permissions = membership.permissions;
}

/** Returns true if the request's role is in `allowed`. */
export function userHasAnyRole(
  current: RoleSlug | undefined,
  allowed: readonly RoleSlug[],
): boolean {
  if (!current) {
    return false;
  }
  return allowed.includes(current);
}

import type { FastifyInstance } from 'fastify';
import { PERMISSIONS, ROLE_SLUGS } from '@constants/rbac.js';
import { requirePermissions, requireRole } from '@http/middleware/rbac.js';
import { workspaceController } from './controllers/workspace.controller.js';

/**
 * Workspace routes. Two route groups:
 *
 *   1. User-scoped (no workspace context required):
 *        POST   /                    create new workspace
 *        GET    /                    list user's workspaces
 *        POST   /switch              switch active workspace
 *
 *   2. Workspace-scoped (requires `x-workspace-id` header matching path id):
 *        GET    /:workspaceId/...
 *        PATCH  /:workspaceId/...
 *        DELETE /:workspaceId/...
 *
 *   Group 2 uses `app.workspaceGuard` which:
 *     - Reads workspace id from path param (we pass it via header for consistency
 *       OR rely on path; the guard already supports both).
 *     - Validates membership.
 *     - Sets request.workspace + request.permissions.
 *
 *   `requirePermissions` then checks granular permissions.
 */
export default async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  // ── Group 1: user-scoped ──────────────────────────────────────────────
  app.post(
    '/',
    {
      preHandler: [app.authenticate],
      schema: { tags: ['workspaces'], summary: 'Create a new workspace', security: [{ bearerAuth: [] }] },
    },
    workspaceController.create,
  );

  app.get(
    '/',
    {
      preHandler: [app.authenticate],
      schema: { tags: ['workspaces'], summary: "List the user's workspaces", security: [{ bearerAuth: [] }] },
    },
    workspaceController.list,
  );

  app.post(
    '/switch',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['workspaces'],
        summary: 'Switch active workspace (issue scoped access token)',
        security: [{ bearerAuth: [] }],
      },
    },
    workspaceController.switch,
  );

  // ── Group 2: workspace-scoped ─────────────────────────────────────────

  app.get(
    '/current',
    {
      preHandler: [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.WORKSPACE_READ)],
      schema: {
        tags: ['workspaces'],
        summary: 'Get the active workspace (resolved by x-workspace-id)',
        security: [{ bearerAuth: [] }],
      },
    },
    workspaceController.current,
  );

  app.patch(
    '/:workspaceId',
    {
      preHandler: [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.WORKSPACE_WRITE)],
      schema: { tags: ['workspaces'], summary: 'Update a workspace', security: [{ bearerAuth: [] }] },
    },
    workspaceController.update,
  );

  app.get(
    '/:workspaceId/settings',
    {
      preHandler: [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.WORKSPACE_READ)],
      schema: { tags: ['workspaces'], summary: 'Get workspace settings', security: [{ bearerAuth: [] }] },
    },
    workspaceController.getSettings,
  );

  app.patch(
    '/:workspaceId/settings',
    {
      preHandler: [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.WORKSPACE_WRITE)],
      schema: { tags: ['workspaces'], summary: 'Update workspace settings', security: [{ bearerAuth: [] }] },
    },
    workspaceController.updateSettings,
  );

  app.get(
    '/:workspaceId/members',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.WORKSPACE_MEMBERS_READ),
      ],
      schema: { tags: ['workspaces'], summary: 'List members', security: [{ bearerAuth: [] }] },
    },
    workspaceController.listMembers,
  );

  app.patch(
    '/:workspaceId/members/:memberId',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.WORKSPACE_MEMBERS_WRITE),
      ],
      schema: { tags: ['workspaces'], summary: 'Update a member role', security: [{ bearerAuth: [] }] },
    },
    workspaceController.updateMemberRole,
  );

  app.delete(
    '/:workspaceId/members/:memberId',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.WORKSPACE_MEMBERS_WRITE),
      ],
      schema: { tags: ['workspaces'], summary: 'Remove a member', security: [{ bearerAuth: [] }] },
    },
    workspaceController.removeMember,
  );

  app.post(
    '/:workspaceId/transfer-ownership',
    {
      preHandler: [app.authenticate, app.workspaceGuard, requireRole(ROLE_SLUGS.OWNER)],
      schema: { tags: ['workspaces'], summary: 'Transfer workspace ownership', security: [{ bearerAuth: [] }] },
    },
    workspaceController.transferOwnership,
  );

  app.post(
    '/:workspaceId/deactivate',
    {
      preHandler: [app.authenticate, app.workspaceGuard, requireRole(ROLE_SLUGS.OWNER)],
      schema: { tags: ['workspaces'], summary: 'Deactivate workspace (owner only)', security: [{ bearerAuth: [] }] },
    },
    workspaceController.deactivate,
  );

  app.post(
    '/:workspaceId/reactivate',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requireRole(ROLE_SLUGS.OWNER, ROLE_SLUGS.ADMIN),
      ],
      schema: { tags: ['workspaces'], summary: 'Reactivate workspace', security: [{ bearerAuth: [] }] },
    },
    workspaceController.reactivate,
  );
}

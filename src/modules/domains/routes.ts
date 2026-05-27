import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@constants/rbac.js';
import { requirePermissions } from '@http/middleware/rbac.js';
import { domainController } from './controllers/domain.controller.js';

/**
 * Domains module routes — all under `/api/v1/domains`.
 *
 * Every route requires:
 *   - Bearer access token  (`app.authenticate`)
 *   - `x-workspace-id` header (`app.workspaceGuard`)
 *   - The granular `domains.read` / `domains.write` permission.
 *
 * Tenant isolation: `app.workspaceGuard` validates membership in the workspace
 * referenced by `x-workspace-id`, and the service/repository pair every query
 * with `workspaceId` in the WHERE clause.
 */
export default async function domainRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.DOMAINS_WRITE),
      ],
      schema: {
        tags: ['domains'],
        summary: 'Onboard a sending domain (creates SES identity)',
        security: [{ bearerAuth: [] }],
      },
    },
    domainController.create,
  );

  app.get(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.DOMAINS_READ),
      ],
      schema: {
        tags: ['domains'],
        summary: 'List sending domains for the active workspace',
        security: [{ bearerAuth: [] }],
      },
    },
    domainController.list,
  );

  app.get(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.DOMAINS_READ),
      ],
      schema: {
        tags: ['domains'],
        summary: 'Get a domain (with DNS records)',
        security: [{ bearerAuth: [] }],
      },
    },
    domainController.get,
  );

  app.post(
    '/:id/verify',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.DOMAINS_WRITE),
      ],
      schema: {
        tags: ['domains'],
        summary: 'Manually requeue domain verification polling',
        security: [{ bearerAuth: [] }],
      },
    },
    domainController.verify,
  );

  app.delete(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.DOMAINS_WRITE),
      ],
      schema: {
        tags: ['domains'],
        summary: 'Soft-delete a domain (idempotent SES identity removal)',
        security: [{ bearerAuth: [] }],
      },
    },
    domainController.remove,
  );
}

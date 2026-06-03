import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@constants/rbac.js';
import { requirePermissions } from '@http/middleware/rbac.js';
import { apiKeyController } from './controllers/api-key.controller.js';

export default async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.WORKSPACE_WRITE),
      ],
      schema: {
        tags: ['api-keys'],
        summary: 'Create an API key for SDK / server-side access',
        security: [{ bearerAuth: [] }],
      },
    },
    apiKeyController.create,
  );

  app.get(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.WORKSPACE_READ),
      ],
      schema: {
        tags: ['api-keys'],
        summary: 'List API keys for the workspace',
        security: [{ bearerAuth: [] }],
      },
    },
    apiKeyController.list,
  );

  app.get(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.WORKSPACE_READ),
      ],
      schema: {
        tags: ['api-keys'],
        summary: 'Get a single API key',
        security: [{ bearerAuth: [] }],
      },
    },
    apiKeyController.get,
  );

  app.delete(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.WORKSPACE_WRITE),
      ],
      schema: {
        tags: ['api-keys'],
        summary: 'Revoke an API key',
        security: [{ bearerAuth: [] }],
      },
    },
    apiKeyController.revoke,
  );
}

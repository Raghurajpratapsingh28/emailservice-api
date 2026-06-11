import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@constants/rbac.js';
import { requirePermissions } from '@http/middleware/rbac.js';
import { analyticsController } from './controllers/analytics.controller.js';

export default async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/summary',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.WORKSPACE_READ),
      ],
      schema: {
        tags: ['analytics'],
        summary: 'Get full workspace dashboard summary (single API call)',
        security: [{ bearerAuth: [] }],
      },
    },
    analyticsController.summary,
  );
}

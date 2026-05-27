import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@constants/rbac.js';
import { requirePermissions } from '@http/middleware/rbac.js';
import { segmentController } from './controllers/segment.controller.js';

export default async function segmentRoutes(app: FastifyInstance): Promise<void> {
  const read = [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.SEGMENTS_READ)];
  const write = [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.SEGMENTS_WRITE)];

  app.post('/', { preHandler: write, schema: { tags: ['segments'], summary: 'Create segment', security: [{ bearerAuth: [] }] } }, segmentController.create);
  app.get('/', { preHandler: read, schema: { tags: ['segments'], summary: 'List segments', security: [{ bearerAuth: [] }] } }, segmentController.list);
  app.get('/:id', { preHandler: read, schema: { tags: ['segments'], summary: 'Get segment', security: [{ bearerAuth: [] }] } }, segmentController.get);
  app.patch('/:id', { preHandler: write, schema: { tags: ['segments'], summary: 'Update segment', security: [{ bearerAuth: [] }] } }, segmentController.update);
  app.delete('/:id', { preHandler: write, schema: { tags: ['segments'], summary: 'Delete segment', security: [{ bearerAuth: [] }] } }, segmentController.remove);
  app.post('/:id/refresh', { preHandler: write, schema: { tags: ['segments'], summary: 'Trigger segment refresh', security: [{ bearerAuth: [] }] } }, segmentController.refresh);
  app.get('/:id/preview', { preHandler: read, schema: { tags: ['segments'], summary: 'Preview segment contacts', security: [{ bearerAuth: [] }] } }, segmentController.preview);
}

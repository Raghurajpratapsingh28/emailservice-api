import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@constants/rbac.js';
import { requirePermissions } from '@http/middleware/rbac.js';
import { workflowController } from './controllers/workflow.controller.js';

export default async function workflowRoutes(app: FastifyInstance): Promise<void> {
  const read = [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.WORKFLOWS_READ)];
  const write = [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.WORKFLOWS_WRITE)];
  const publish = [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.WORKFLOWS_PUBLISH)];

  app.post('/', { preHandler: write, schema: { tags: ['workflows'], summary: 'Create workflow', security: [{ bearerAuth: [] }] } }, workflowController.create);
  app.get('/', { preHandler: read, schema: { tags: ['workflows'], summary: 'List workflows', security: [{ bearerAuth: [] }] } }, workflowController.list);
  app.get('/:id', { preHandler: read, schema: { tags: ['workflows'], summary: 'Get workflow', security: [{ bearerAuth: [] }] } }, workflowController.get);
  app.patch('/:id', { preHandler: write, schema: { tags: ['workflows'], summary: 'Update workflow', security: [{ bearerAuth: [] }] } }, workflowController.update);
  app.post('/:id/publish', { preHandler: publish, schema: { tags: ['workflows'], summary: 'Publish workflow', security: [{ bearerAuth: [] }] } }, workflowController.publish);
  app.post('/:id/pause', { preHandler: publish, schema: { tags: ['workflows'], summary: 'Pause workflow', security: [{ bearerAuth: [] }] } }, workflowController.pause);
  app.post('/:id/resume', { preHandler: publish, schema: { tags: ['workflows'], summary: 'Resume workflow', security: [{ bearerAuth: [] }] } }, workflowController.resume);
  app.delete('/:id', { preHandler: write, schema: { tags: ['workflows'], summary: 'Delete workflow', security: [{ bearerAuth: [] }] } }, workflowController.remove);
  app.get('/:id/executions', { preHandler: read, schema: { tags: ['workflows'], summary: 'List executions', security: [{ bearerAuth: [] }] } }, workflowController.listExecutions);
}

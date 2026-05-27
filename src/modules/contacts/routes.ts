import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@constants/rbac.js';
import { requirePermissions } from '@http/middleware/rbac.js';
import { contactController } from './controllers/contact.controller.js';

export default async function contactRoutes(app: FastifyInstance): Promise<void> {
  const read = [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.CONTACTS_READ)];
  const write = [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.CONTACTS_WRITE)];

  app.post('/', { preHandler: write, schema: { tags: ['contacts'], summary: 'Create contact', security: [{ bearerAuth: [] }] } }, contactController.create);
  app.get('/', { preHandler: read, schema: { tags: ['contacts'], summary: 'List contacts', security: [{ bearerAuth: [] }] } }, contactController.list);
  app.get('/:id', { preHandler: read, schema: { tags: ['contacts'], summary: 'Get contact', security: [{ bearerAuth: [] }] } }, contactController.get);
  app.patch('/:id', { preHandler: write, schema: { tags: ['contacts'], summary: 'Update contact', security: [{ bearerAuth: [] }] } }, contactController.update);
  app.delete('/:id', { preHandler: write, schema: { tags: ['contacts'], summary: 'Delete contact', security: [{ bearerAuth: [] }] } }, contactController.remove);
  app.post('/bulk-import', { preHandler: write, schema: { tags: ['contacts'], summary: 'Bulk import contacts', security: [{ bearerAuth: [] }] } }, contactController.bulkImport);
  app.post('/:id/suppress', { preHandler: write, schema: { tags: ['contacts'], summary: 'Suppress contact', security: [{ bearerAuth: [] }] } }, contactController.suppress);
  app.post('/:id/unsuppress', { preHandler: write, schema: { tags: ['contacts'], summary: 'Unsuppress contact', security: [{ bearerAuth: [] }] } }, contactController.unsuppress);
}

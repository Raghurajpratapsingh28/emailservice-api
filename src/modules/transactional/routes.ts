import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@constants/rbac.js';
import { requirePermissions } from '@http/middleware/rbac.js';
import { transactionalController } from './controllers/transactional.controller.js';

/**
 * Transactional email routes — mounted at `/api/v1/emails`.
 * All require authentication + workspace + workspace-scoped permissions.
 */
export default async function emailSendRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/send',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.EMAILS_SEND),
      ],
      schema: {
        tags: ['emails'],
        summary: 'Queue a transactional email send',
        security: [{ bearerAuth: [] }],
      },
    },
    transactionalController.send,
  );

  app.get(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.EMAILS_READ),
      ],
      schema: {
        tags: ['emails'],
        summary: 'List transactional sends',
        security: [{ bearerAuth: [] }],
      },
    },
    transactionalController.listSends,
  );

  app.get(
    '/:sendId',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.EMAILS_READ),
      ],
      schema: {
        tags: ['emails'],
        summary: 'Get a transactional send by id',
        security: [{ bearerAuth: [] }],
      },
    },
    transactionalController.getSend,
  );
}

/**
 * Email template routes — mounted at `/api/v1/email-templates`.
 */
export async function emailTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.TEMPLATES_WRITE),
      ],
      schema: {
        tags: ['email-templates'],
        summary: 'Create a draft email template',
        security: [{ bearerAuth: [] }],
      },
    },
    transactionalController.createTemplate,
  );

  app.get(
    '/',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.TEMPLATES_READ),
      ],
      schema: {
        tags: ['email-templates'],
        summary: 'List email templates',
        security: [{ bearerAuth: [] }],
      },
    },
    transactionalController.listTemplates,
  );

  app.get(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.TEMPLATES_READ),
      ],
      schema: {
        tags: ['email-templates'],
        summary: 'Get a template by id',
        security: [{ bearerAuth: [] }],
      },
    },
    transactionalController.getTemplate,
  );

  app.patch(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.TEMPLATES_WRITE),
      ],
      schema: {
        tags: ['email-templates'],
        summary: 'Update a draft template (clones from published if needed)',
        security: [{ bearerAuth: [] }],
      },
    },
    transactionalController.updateTemplate,
  );

  app.delete(
    '/:id',
    {
      preHandler: [
        app.authenticate,
        app.workspaceGuard,
        requirePermissions(PERMISSIONS.TEMPLATES_WRITE),
      ],
      schema: {
        tags: ['email-templates'],
        summary: 'Soft-delete a template',
        security: [{ bearerAuth: [] }],
      },
    },
    transactionalController.deleteTemplate,
  );
}

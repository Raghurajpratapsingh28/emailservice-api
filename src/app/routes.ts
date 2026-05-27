import type { FastifyInstance } from 'fastify';
import authRoutes from '@modules/auth/routes.js';
import workspaceRoutes from '@modules/workspaces/routes.js';
import domainRoutes from '@modules/domains/routes.js';
import emailSendRoutes, { emailTemplateRoutes } from '@modules/transactional/routes.js';
import campaignRoutes from '@modules/campaigns/routes.js';
import eventRoutes from '@modules/events/routes.js';
import contactRoutes from '@modules/contacts/routes.js';
import segmentRoutes from '@modules/segments/routes.js';
import workflowRoutes from '@modules/workflows/routes.js';
import billingRoutes, { stripeWebhookRoutes } from '@modules/billing/routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    { schema: { tags: ['health'], summary: 'Liveness probe' } },
    async () => ({ status: 'ok' }),
  );

  app.get(
    '/ready',
    { schema: { tags: ['health'], summary: 'Readiness probe' } },
    async (req) => {
      try {
        await req.server.dbClient`SELECT 1`;
        await req.server.redis.ping();
      } catch (err) {
        req.log.error({ err }, 'readiness check failed');
        return Promise.reject(new Error('not ready'));
      }
      return { status: 'ready' };
    },
  );

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(workspaceRoutes, { prefix: '/workspaces' });
      await api.register(domainRoutes, { prefix: '/domains' });
      await api.register(emailSendRoutes, { prefix: '/emails' });
      await api.register(emailTemplateRoutes, { prefix: '/email-templates' });
      await api.register(campaignRoutes, { prefix: '/campaigns' });
      // Event ingestion routes — write-key auth, no JWT required
      await api.register(eventRoutes);
      await api.register(contactRoutes, { prefix: '/contacts' });
      await api.register(segmentRoutes, { prefix: '/segments' });
      await api.register(workflowRoutes, { prefix: '/workflows' });
      await api.register(billingRoutes, { prefix: '/billing' });
      await api.register(stripeWebhookRoutes, { prefix: '/webhooks' });
    },
    { prefix: '/api/v1' },
  );
}

import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createNats, type NatsClient } from '@shared/queue/nats.js';
import { createEmailPublisher, type EmailPublisher } from '@shared/email/ses.js';
import { createSystemEmailSender, type SystemEmailSender } from '@shared/email/ses-mailer.js';

declare module 'fastify' {
  interface FastifyInstance {
    nats: NatsClient;
    email: EmailPublisher;
    systemEmail: SystemEmailSender;
  }
}

/**
 * Decorates Fastify with:
 *   - `app.nats`        — NATS client for publishing to the worker pipeline
 *   - `app.email`       — customer-facing transactional email publisher (via NATS)
 *   - `app.systemEmail` — direct SES sender for auth/system emails (bypasses worker)
 */
export default fp(
  async function natsPlugin(app: FastifyInstance) {
    const nats = await createNats();
    const email = createEmailPublisher(nats);
    const systemEmail = createSystemEmailSender();

    app.decorate('nats', nats);
    app.decorate('email', email);
    app.decorate('systemEmail', systemEmail);

    app.addHook('onClose', async () => {
      app.log.info('[nats] draining connection');
      await nats.close().catch((err) => app.log.error({ err }, '[nats] drain failed'));
    });
  },
  { name: 'nats-plugin' },
);

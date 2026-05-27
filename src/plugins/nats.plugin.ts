import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createNats, type NatsClient } from '@shared/queue/nats.js';
import { createEmailPublisher, type EmailPublisher } from '@shared/email/ses.js';

declare module 'fastify' {
  interface FastifyInstance {
    nats: NatsClient;
    email: EmailPublisher;
  }
}

/**
 * Decorates Fastify with `app.nats` and `app.email`. The email publisher is wired
 * to publish over NATS so deliveries are async and retried by the worker tier.
 */
export default fp(
  async function natsPlugin(app: FastifyInstance) {
    const nats = await createNats();
    const email = createEmailPublisher(nats);

    app.decorate('nats', nats);
    app.decorate('email', email);

    app.addHook('onClose', async () => {
      app.log.info('[nats] draining connection');
      await nats.close().catch((err) => app.log.error({ err }, '[nats] drain failed'));
    });
  },
  { name: 'nats-plugin' },
);

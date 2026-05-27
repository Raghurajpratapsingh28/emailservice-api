import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createRedis, type Redis } from '@shared/cache/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

/**
 * Decorates Fastify with `app.redis` (ioredis) and closes it cleanly on shutdown.
 */
export default fp(
  async function redisPlugin(app: FastifyInstance) {
    const redis = createRedis();

    redis.on('error', (err) => {
      app.log.error({ err }, '[redis] connection error');
    });
    redis.on('ready', () => {
      app.log.info('[redis] ready');
    });

    app.decorate('redis', redis);

    app.addHook('onClose', async () => {
      app.log.info('[redis] Closing connection');
      await redis.quit().catch(() => undefined);
    });
  },
  { name: 'redis-plugin' },
);

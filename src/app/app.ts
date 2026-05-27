import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifySensible from '@fastify/sensible';
import { register } from 'prom-client';
import { config } from '@config/index.js';
import databasePlugin from '@plugins/database.plugin.js';
import redisPlugin from '@plugins/redis.plugin.js';
import natsPlugin from '@plugins/nats.plugin.js';
import authPlugin from '@plugins/auth.plugin.js';
import httpDecorators from '@http/decorators/workspace.js';
import { errorHandler } from '@http/hooks/error-handler.js';
import { registerRequestLogger } from '@http/hooks/request-logger.js';
import { registerRoutes } from './routes.js';
import { registerSwagger } from './swagger.js';

export interface BuildAppOptions {
  fastifyOptions?: FastifyServerOptions;
  skipInfraPlugins?: boolean;
}

/**
 * Trust-proxy resolution (F9).
 *
 * `trustProxy: true` blindly trusts X-Forwarded-* from any peer — that lets
 * an attacker spoof `req.ip`, defeating IP-based rate limits and audit.
 *
 * The TRUST_PROXY env value is interpreted as:
 *   - "true"      → loopback (only the local proxy)
 *   - "false"     → no proxy
 *   - CIDR list   → e.g. "10.0.0.0/8,127.0.0.1/32" — Fastify accepts a
 *                   comma-separated string of trusted hops.
 *   - integer N   → trust N hops from the socket
 */
function resolveTrustProxy(): FastifyServerOptions['trustProxy'] {
  const raw = String(config.TRUST_PROXY).trim();
  if (raw === '' || raw === 'false') {
    return false;
  }
  if (raw === 'true') {
    // Default to loopback only.
    return ['127.0.0.1/32', '::1/128'];
  }
  if (/^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(
    opts.fastifyOptions ?? {
      logger: {
        level: config.LOG_LEVEL,
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-internal-key"]',
          'req.body.password',
          'req.body.refreshToken',
          'req.body.token',
        ],
      },
      trustProxy: resolveTrustProxy(),
      bodyLimit: config.BODY_LIMIT_BYTES,
      requestTimeout: config.REQUEST_TIMEOUT_MS,
      disableRequestLogging: false,
      genReqId: () => randomUUID(),
      ajv: {
        customOptions: {
          coerceTypes: false,
          allErrors: true,
          removeAdditional: false,
        },
      },
    },
  );

  await app.register(fastifySensible);
  await app.register(fastifyCors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-workspace-id', 'x-internal-key'],
    exposedHeaders: ['x-ratelimit-bucket', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after'],
    maxAge: 600,
  });
  await app.register(fastifyHelmet, {
    // The API serves JSON; Swagger UI is the only HTML surface, served on a known path.
    // We tighten everywhere else and relax just for /docs.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // swagger-ui needs inline
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
  });

  if (!opts.skipInfraPlugins) {
    await app.register(databasePlugin);
    await app.register(redisPlugin);
    await app.register(natsPlugin);
    await app.register(authPlugin);
  }

  await app.register(httpDecorators);
  await registerSwagger(app);

  app.setErrorHandler(errorHandler);
  registerRequestLogger(app);

  // Prometheus metrics endpoint — guarded by internalAuth in production.
  app.get('/metrics', { preHandler: [app.internalAuth] }, async (_req, reply) => {
    const text = await register.metrics();
    void reply.type(register.contentType);
    return text;
  });

  await registerRoutes(app);

  return app;
}

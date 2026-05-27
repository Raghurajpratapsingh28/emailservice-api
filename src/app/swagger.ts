import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { config } from '@config/index.js';

/**
 * Registers OpenAPI + Swagger UI when enabled. Disabled by default in production
 * unless SWAGGER_ENABLED=true.
 */
export async function registerSwagger(app: FastifyInstance): Promise<void> {
  if (!config.SWAGGER_ENABLED) {
    return;
  }

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: `${config.APP_NAME} API`,
        description: 'EngageIQ HTTP API',
        version: config.APP_VERSION,
      },
      servers: [{ url: config.API_PUBLIC_URL }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          internalKey: {
            type: 'apiKey',
            in: 'header',
            name: 'x-internal-key',
          },
          workspaceHeader: {
            type: 'apiKey',
            in: 'header',
            name: 'x-workspace-id',
          },
        },
      },
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: config.SWAGGER_PATH,
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
}

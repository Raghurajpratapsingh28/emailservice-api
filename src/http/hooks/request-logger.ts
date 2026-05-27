import type { FastifyInstance } from 'fastify';

/**
 * Adds a structured request log on completion. Fastify already logs requests
 * by default; this hook ensures we include the workspace context where present
 * and elides noisy fields.
 */
export function registerRequestLogger(app: FastifyInstance): void {
  app.addHook('onResponse', (req, reply, done) => {
    req.log.info(
      {
        method: req.method,
        url: req.url,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
        userId: req.authedUser?.id,
        workspaceId: req.workspace?.id,
      },
      'request_completed',
    );
    done();
  });
}

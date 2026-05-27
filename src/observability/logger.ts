import { createLogger, format, transports, type Logger } from 'winston';
import { config } from '@config/index.js';

/**
 * Application logger. Fastify has its own pino-based logger (configured in app.ts);
 * this one is for non-request code paths (jobs, seeders, startup).
 */
export const logger: Logger = createLogger({
  level: config.LOG_LEVEL,
  defaultMeta: { service: config.APP_NAME, env: config.NODE_ENV },
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    config.isProduction ? format.json() : format.combine(format.colorize(), format.simple()),
  ),
  transports: [new transports.Console()],
  exitOnError: false,
});

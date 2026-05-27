import { config } from '@config/index.js';
import { buildApp } from './app.js';

/**
 * Process entrypoint. Builds the app, listens, wires graceful shutdown.
 */
async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down...');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

void main();

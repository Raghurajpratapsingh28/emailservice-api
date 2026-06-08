import { connect, JSONCodec } from 'nats';
import { config } from '@config/index.js';
import { createDb } from '@shared/database/client.js';
import { logger } from '@observability/logger.js';
import { SegmentRepository } from '@modules/segments/repositories/segment.repository.js';
import { SegmentRefreshProcessor } from './processors/segment-refresh.processor.js';

const codec = JSONCodec();

// Adapt winston logger to the pino-style WorkerLogger interface used by processors
const log = {
  info: (obj: Record<string, unknown> | string, msg?: string) =>
    typeof obj === 'string' ? logger.info(obj) : logger.info(msg ?? '', obj),
  warn: (obj: Record<string, unknown> | string, msg?: string) =>
    typeof obj === 'string' ? logger.warn(obj) : logger.warn(msg ?? '', obj),
  error: (obj: Record<string, unknown> | string, msg?: string) =>
    typeof obj === 'string' ? logger.error(obj) : logger.error(msg ?? '', obj),
};

interface SegmentRefreshPayload {
  workspaceId: string;
  segmentId: string;
}

async function main(): Promise<void> {
  const { db } = createDb();
  const nats = await connect({
    servers: config.NATS_URL,
    name: 'segment-worker',
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 1000,
  });

  const segmentRepo = new SegmentRepository(db);
  const processor = new SegmentRefreshProcessor(db, segmentRepo, log);

  const subscription = nats.subscribe('segment.refresh');
  log.info('listening for segment.refresh messages');

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutting down worker');
    try {
      await subscription.drain();
      await nats.drain();
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  for await (const msg of subscription) {
    try {
      const payload = codec.decode(msg.data) as SegmentRefreshPayload;
      log.info({ payload }, 'processing segment refresh');
      await processor.processRefresh(payload.workspaceId, payload.segmentId);
    } catch (err) {
      log.error({ err }, 'failed to process segment refresh');
    }
  }
}

void main();

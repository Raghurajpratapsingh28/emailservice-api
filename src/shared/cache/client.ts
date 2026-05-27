import { Redis, type RedisOptions } from 'ioredis';
import { config } from '@config/index.js';

export function createRedis(opts: RedisOptions = {}): Redis {
  return new Redis(config.REDIS_URL, {
    keyPrefix: config.REDIS_KEY_PREFIX,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    ...opts,
  });
}

export type { Redis };

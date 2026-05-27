import { connect, JSONCodec, type NatsConnection } from 'nats';
import { config } from '@config/index.js';

/**
 * NATS connection factory. Lifetime is owned by `nats.plugin`.
 *
 * We use a JSON codec for application-level events. Subjects live in
 * `src/constants/nats-subjects.ts`.
 */

const codec = JSONCodec();

export interface NatsClient {
  connection: NatsConnection;
  publish: <T = unknown>(subject: string, payload: T) => void;
  request: <Req = unknown, Res = unknown>(
    subject: string,
    payload: Req,
    timeoutMs?: number,
  ) => Promise<Res>;
  close: () => Promise<void>;
}

export async function createNats(): Promise<NatsClient> {
  const connection = await connect({
    servers: config.NATS_URL,
    name: config.NATS_NAME,
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 1000,
  });

  return {
    connection,
    publish<T = unknown>(subject: string, payload: T): void {
      connection.publish(subject, codec.encode(payload));
    },
    async request<Req = unknown, Res = unknown>(
      subject: string,
      payload: Req,
      timeoutMs = 5000,
    ): Promise<Res> {
      const msg = await connection.request(subject, codec.encode(payload), {
        timeout: timeoutMs,
      });
      return codec.decode(msg.data) as Res;
    },
    async close(): Promise<void> {
      await connection.drain();
    },
  };
}

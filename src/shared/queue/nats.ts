import { connect, JSONCodec, type NatsConnection, type JetStreamClient } from 'nats';
import { config } from '@config/index.js';

const codec = JSONCodec();

export interface NatsClient {
  connection: NatsConnection;
  js: JetStreamClient;
  publish: <T = unknown>(subject: string, payload: T) => Promise<void>;
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

  const js = connection.jetstream();

  return {
    connection,
    js,
    async publish<T = unknown>(subject: string, payload: T): Promise<void> {
      await js.publish(subject, codec.encode(payload));
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

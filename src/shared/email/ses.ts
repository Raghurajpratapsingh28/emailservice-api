import { config } from '@config/index.js';
import { NATS_SUBJECTS } from '@constants/nats-subjects.js';
import type { NatsClient } from '@shared/queue/nats.js';

/**
 * Email publisher. We don't call SES directly from the API — we publish a NATS
 * event, and a downstream worker (transactional service) handles delivery. This
 * keeps the request path fast and decouples retries.
 *
 * The interface is small so it can be mocked in tests via the plugin.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
  /** Idempotency key — downstream consumers dedupe on this. */
  idempotencyKey?: string;
}

export interface EmailPublisher {
  send(msg: EmailMessage): Promise<void>;
}

export function createEmailPublisher(nats: NatsClient): EmailPublisher {
  return {
    async send(msg: EmailMessage): Promise<void> {
      nats.publish(NATS_SUBJECTS.EMAIL_TRANSACTIONAL_SEND, {
        to: msg.to,
        subject: msg.subject,
        template: msg.template,
        data: msg.data,
        from: config.EMAIL_FROM,
        replyTo: config.EMAIL_REPLY_TO,
        idempotencyKey: msg.idempotencyKey,
        publishedAt: new Date().toISOString(),
      });
    },
  };
}

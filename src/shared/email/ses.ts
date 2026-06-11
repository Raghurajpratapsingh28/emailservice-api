import { config } from '@config/index.js';
import { NATS_SUBJECTS } from '@constants/nats-subjects.js';
import type { NatsClient } from '@shared/queue/nats.js';

/**
 * Email publisher for customer-facing transactional sends.
 *
 * Publishes to the NATS worker pipeline (email.send.transactional).
 * The worker handles SES delivery, retries, and delivery events.
 *
 * NOT used for system/auth emails — those go direct via ses-mailer.ts.
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

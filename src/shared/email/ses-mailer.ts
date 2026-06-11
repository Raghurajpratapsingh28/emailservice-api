import {
  SESv2Client,
  SendEmailCommand,
} from '@aws-sdk/client-sesv2';
import { config } from '@config/index.js';
import { renderTemplate } from './templates.js';

/**
 * Direct SES sender for system/auth emails (verification, password reset, invites).
 *
 * This bypasses the NATS worker pipeline entirely — that pipeline is for
 * customer-facing email campaigns and transactional sends. System emails go
 * straight to SES from the API process.
 */

export interface SystemEmailMessage {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface SystemEmailSender {
  send(msg: SystemEmailMessage): Promise<void>;
}

export function createSystemEmailSender(): SystemEmailSender {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  const client = new SESv2Client({
    region: config.AWS_REGION,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });

  // Parse "Display Name <email@example.com>" or plain "email@example.com"
  const fromMatch = config.EMAIL_FROM.match(/^(.+)\s+<(.+)>$/);
  const fromEmail = fromMatch ? fromMatch[2]! : config.EMAIL_FROM;
  const fromName = fromMatch ? fromMatch[1]! : undefined;
  const fromAddress = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

  return {
    async send(msg: SystemEmailMessage): Promise<void> {
      const { html, text } = renderTemplate(msg.template, msg.data);

      await client.send(
        new SendEmailCommand({
          FromEmailAddress: fromAddress,
          Destination: { ToAddresses: [msg.to] },
          ReplyToAddresses: config.EMAIL_REPLY_TO ? [config.EMAIL_REPLY_TO] : undefined,
          Content: {
            Simple: {
              Subject: { Data: msg.subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: html, Charset: 'UTF-8' },
                Text: { Data: text, Charset: 'UTF-8' },
              },
            },
          },
        }),
      );
    },
  };
}

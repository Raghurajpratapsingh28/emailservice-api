import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  type IdentityType,
  PutEmailIdentityDkimAttributesCommand,
  SESv2Client,
  type DkimStatus,
  type VerificationStatus,
} from '@aws-sdk/client-sesv2';
import { config } from '@config/index.js';

/**
 * Thin wrapper around AWS SES v2 for **identity (sending domain) management only**.
 *
 * Outbound email sending is handled by the transactional worker; this module is
 * solely concerned with provisioning, querying, and deleting *domain identities*
 * (CreateEmailIdentity, GetEmailIdentity, DeleteEmailIdentity, DKIM toggling).
 *
 * Wrapped behind a small interface so the service can be unit-tested with an
 * in-memory mock without pulling in the AWS SDK at test time.
 */

export interface SesIdentityCreated {
  /** SES typically does not return an ARN on CreateEmailIdentity; computed via region+account if needed. */
  identityArn?: string;
  dkimTokens: string[];
  verificationStatus: VerificationStatus | string;
  dkimStatus?: DkimStatus | string;
}

export interface SesIdentityStatus {
  exists: boolean;
  verificationStatus?: VerificationStatus | string;
  dkimStatus?: DkimStatus | string;
  dkimTokens: string[];
}

export interface SesIdentityClient {
  createDomainIdentity(domain: string): Promise<SesIdentityCreated>;
  getIdentity(domain: string): Promise<SesIdentityStatus>;
  deleteIdentity(domain: string): Promise<void>;
  /** Toggle Easy DKIM if needed (idempotent). */
  enableEasyDkim(domain: string): Promise<void>;
}

export interface CreateSesIdentityClientOptions {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Production SES client. The AWS SDK reads credentials from the standard
 * provider chain (env vars, EC2/ECS metadata, shared credentials file). We
 * pass them explicitly only if provided in config.
 */
export function createSesIdentityClient(
  opts: CreateSesIdentityClientOptions = {},
): SesIdentityClient {
  const region = opts.region ?? config.AWS_REGION;
  const accessKeyId = opts.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = opts.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY;

  const client = new SESv2Client({
    region,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });

  return {
    async createDomainIdentity(domain) {
      const out = await client.send(
        new CreateEmailIdentityCommand({
          EmailIdentity: domain,
          // Tags are intentionally omitted — populated by service layer if needed.
        }),
      );
      // SES v2 returns DkimAttributes with Tokens for domain identities.
      return {
        identityArn: undefined,
        dkimTokens: out.DkimAttributes?.Tokens ?? [],
        verificationStatus: out.VerifiedForSendingStatus ? 'PENDING' : 'PENDING',
        dkimStatus: out.DkimAttributes?.Status ?? 'PENDING',
      };
    },

    async getIdentity(domain) {
      try {
        const out = await client.send(
          new GetEmailIdentityCommand({ EmailIdentity: domain }),
        );
        return {
          exists: true,
          verificationStatus: out.VerifiedForSendingStatus ? 'SUCCESS' : 'PENDING',
          dkimStatus: out.DkimAttributes?.Status,
          dkimTokens: out.DkimAttributes?.Tokens ?? [],
        };
      } catch (err) {
        // SES throws NotFoundException when the identity is absent.
        if (
          err instanceof Error &&
          (err.name === 'NotFoundException' || (err as { name?: string }).name === 'NotFoundException')
        ) {
          return { exists: false, dkimTokens: [] };
        }
        throw err;
      }
    },

    async deleteIdentity(domain) {
      try {
        await client.send(new DeleteEmailIdentityCommand({ EmailIdentity: domain }));
      } catch (err) {
        // Idempotent delete: swallow NotFound.
        if (err instanceof Error && err.name === 'NotFoundException') {
          return;
        }
        throw err;
      }
    },

    async enableEasyDkim(domain) {
      await client.send(
        new PutEmailIdentityDkimAttributesCommand({
          EmailIdentity: domain,
          SigningEnabled: true,
        }),
      );
    },
  };
}

/**
 * Discriminated re-export — keeps the SDK import out of test files that mock
 * this module via the SesIdentityClient interface.
 */
export type { IdentityType, VerificationStatus, DkimStatus };

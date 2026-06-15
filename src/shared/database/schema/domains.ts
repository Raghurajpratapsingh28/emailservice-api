import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

/**
 * Sending-domain onboarding records.
 *
 * Lifecycle:
 *   pending      → created, SES identity provisioned, awaiting DNS / DKIM verification
 *   verifying    → at least one verification poll has run; DKIM not yet validated
 *   verified     → SES reports VerificationStatus = Success and DKIM enabled
 *   failed       → SES reports VerificationStatus = Failed
 *   deleting     → soft-deleted in DB; identity removal from SES is async
 *   deleted      → tombstone retained for audit
 */
export const DOMAIN_STATUS = [
  'pending',
  'verifying',
  'verified',
  'failed',
  'deleting',
  'deleted',
] as const;
export type DomainStatus = (typeof DOMAIN_STATUS)[number];

export const domains = pgTable(
  'domains',
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Lowercased ASCII domain. */
    domain: varchar({ length: 253 }).notNull(),
    /** SES identity name (typically equals `domain`). */
    sesIdentity: varchar({ length: 253 }).notNull(),
    sesIdentityArn: varchar({ length: 512 }),
    status: varchar({ length: 16 }).notNull().default('pending'),
    /** DKIM token list returned by SES (Easy DKIM legacy). Used to render DNS records on demand. */
    dkimTokens: jsonb().notNull().default(sql`'[]'::jsonb`),
    /**
     * BYODKIM selector — unique per workspace/domain registration. Makes the
     * DKIM DNS record (`<selector>._domainkey.<domain>`) unique so a previous
     * owner's published records can never auto-verify a new registration.
     */
    dkimSelector: varchar({ length: 63 }),
    /** BYODKIM public key (base64, no PEM headers) for the TXT record value. */
    dkimPublicKey: varchar({ length: 1024 }),
    verificationStartedAt: timestamp({ withTimezone: true }),
    verifiedAt: timestamp({ withTimezone: true }),
    lastVerificationCheckAt: timestamp({ withTimezone: true }),
    verificationAttempts: integer().notNull().default(0),
    /** Optimistic concurrency token. */
    version: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    /** A workspace cannot register the same domain twice (active rows). */
    uniqueIndex('domains_workspace_domain_uniq').on(t.workspaceId, t.domain),
    index('domains_workspace_idx').on(t.workspaceId),
    index('domains_status_idx').on(t.status),
    index('domains_domain_idx').on(t.domain),
    index('domains_active_idx').on(t.workspaceId, t.deletedAt),
  ],
);

export type Domain = typeof domains.$inferSelect;
export type NewDomain = typeof domains.$inferInsert;

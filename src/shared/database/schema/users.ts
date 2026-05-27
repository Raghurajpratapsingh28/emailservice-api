import {
  boolean,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Users.
 *
 * Hardening notes:
 *  - `passwordChangedAt` is checked against the JWT `iat` claim; any access token
 *    minted before this timestamp is rejected (instant kill of all access tokens
 *    on password change without requiring a Redis lookup).
 *  - `failedLoginWindowStart` lets us decay the lockout counter without needing
 *    background jobs.
 *  - `lastLoginIp` uses Postgres `inet` (custom override at migration time).
 */
export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: varchar({ length: 254 }).notNull(),
    emailNormalized: varchar({ length: 254 }).notNull(),
    passwordHash: varchar({ length: 255 }).notNull(),
    passwordChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    firstName: varchar({ length: 100 }),
    lastName: varchar({ length: 100 }),
    isEmailVerified: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    failedLoginAttempts: integer().notNull().default(0),
    failedLoginWindowStart: timestamp({ withTimezone: true }),
    lockedUntil: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    lastLoginIp: varchar({ length: 64 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_normalized_uniq').on(t.emailNormalized),
    index('users_email_idx').on(t.email),
    index('users_active_idx').on(t.isActive),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

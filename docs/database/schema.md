# Database Schema

## Tables

| Table | Purpose |
|-------|---------|
| `users` | Global user accounts |
| `workspaces` | Tenants |
| `workspace_settings` | Per-workspace config (timezone, branding, feature flags, webhooks) |
| `workspace_members` | User ↔ workspace membership with role |
| `roles` | Role catalog (seeded: owner, admin, member, viewer) |
| `permissions` | Permission catalog (seeded) |
| `role_permissions` | Role → permission mapping |
| `refresh_tokens` | Opaque refresh token store |
| `password_reset_tokens` | Password reset token store |
| `email_verification_tokens` | Email verification token store |
| `invites` | Workspace invitations |
| `audit_logs` | Append-only security audit trail |
| `domains` | AWS SES sending-domain onboarding records |
| `email_templates` | Versioned transactional email templates (draft/published/archived) |
| `email_sends` | Per-send records for transactional emails |
| `contacts` | Contact profiles with properties JSONB |
| `contact_tags` | Many-to-many contact ↔ tag |
| `segments` | Contact segment definitions with filter DSL |
| `segment_memberships` | Materialized segment ↔ contact membership |
| `campaigns` | Campaign lifecycle records |
| `campaign_recipients` | Per-recipient delivery records for campaigns |
| `workflows` | Workflow definitions with graph JSONB |
| `workflow_executions` | Per-contact execution tracking |
| `subscriptions` | One Stripe subscription record per workspace |
| `billing_events` | Append-only audit of every Stripe webhook event (idempotency store) |
| `usage_counters` | Per-(workspace, metric, billing period) usage counters |
| `invoices` | Local mirror of Stripe invoices |

## Key columns

### workspaces

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `slug` | varchar(64) UNIQUE | Used in public URLs |
| `name` | varchar(200) | |
| `plan` | varchar(32) | `free`, `starter`, `pro`, `enterprise` |
| `status` | varchar(16) | `active`, `inactive`, `deleted` |
| `owner_user_id` | uuid | Current owner — kept in sync on transfer-ownership |
| `metadata` | jsonb | Free-form per-tenant metadata |
| `version` | integer | Optimistic concurrency token; bumped on every UPDATE |
| `deleted_at` | timestamptz | Soft delete |

### workspace_settings

| Column | Type | Notes |
|--------|------|-------|
| `workspace_id` | uuid UNIQUE FK | One row per workspace, cascade on delete |
| `timezone` | varchar(64) | Default `UTC` |
| `locale` | varchar(16) | Default `en-US` |
| `branding` | jsonb | `{ logoUrl, primaryColor, faviconUrl }` |
| `email_defaults` | jsonb | `{ fromName, fromEmail, replyTo, footerHtml }` |
| `feature_flags` | jsonb | `{ flag_name: boolean }` |
| `webhook_settings` | jsonb | `{ url, secret, events[] }` |

### domains

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `workspace_id` | uuid FK CASCADE | Tenant scope |
| `domain` | varchar(253) | Lowercased ASCII |
| `ses_identity` | varchar(253) | SES identity name (= domain) |
| `ses_identity_arn` | varchar(512) | Populated if SES returns an ARN |
| `status` | varchar(16) | `pending`, `verifying`, `verified`, `failed`, `deleting`, `deleted` |
| `dkim_tokens` | jsonb | String array of DKIM tokens from SES |
| `verification_started_at` | timestamptz | |
| `verified_at` | timestamptz | |
| `last_verification_check_at` | timestamptz | Updated by the polling worker |
| `verification_attempts` | integer | Bumped by the polling worker |
| `version` | integer | Optimistic concurrency token |
| `deleted_at` | timestamptz | Soft delete tombstone |

Unique constraint: `(workspace_id, domain)` — a workspace cannot register the same domain twice.

### users

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `email` | varchar(254) | Original case |
| `email_normalized` | varchar(254) UNIQUE | Lowercase, used for lookups |
| `password_hash` | varchar(255) | bcrypt, never returned |
| `password_changed_at` | timestamptz | Used to invalidate access tokens on password change |
| `is_email_verified` | boolean | Default false |
| `is_active` | boolean | Default true; false = soft-disabled |
| `failed_login_attempts` | integer | Sliding-window lockout counter |
| `failed_login_window_start` | timestamptz | Start of the current lockout window |
| `locked_until` | timestamptz | Null = not locked |
| `last_login_at` | timestamptz | |
| `deleted_at` | timestamptz | Soft delete |

### refresh_tokens

| Column | Type | Notes |
|--------|------|-------|
| `token_hash` | varchar(128) UNIQUE | SHA-256 of plaintext |
| `previous_token_hash` | varchar(128) | Hash of the prior token in this family (grace window) |
| `rotation_grace_until` | timestamptz | Grace window expiry |
| `family_id` | uuid | All rotations of one session share a family |
| `replaced_by_id` | uuid | Points to the successor row |
| `revoked_at` | timestamptz | Null = active |
| `revoked_reason` | varchar(64) | `rotated`, `logout`, `logout_all`, `password_reset`, `family_compromised`, `session_cap`, `user_revoked` |
| `expires_at` | timestamptz | 30 days from issue |

### audit_logs

| Column | Type | Notes |
|--------|------|-------|
| `action` | varchar(100) | e.g. `auth.login.success` |
| `metadata` | jsonb | Structured context, never contains secrets |
| `request_id` | varchar(64) | Correlates with HTTP request logs |
| `actor_user_id` | uuid | Null on deletion (set null FK) |
| `workspace_id` | uuid | Null on deletion (set null FK) |

## Indexes

Performance-critical indexes:

- `users.email_normalized` — UNIQUE, used on every login
- `refresh_tokens.token_hash` — UNIQUE, used on every refresh
- `refresh_tokens.previous_token_hash` — used for grace-window lookup
- `refresh_tokens.(user_id, revoked_at)` — active-session queries
- `refresh_tokens.family_id` — family compromise revocation
- `audit_logs.(action, created_at)` — time-range queries per action type

## Migrations

```bash
# Generate a new migration after schema changes
npm run db:generate

# Apply all pending migrations
npm run db:migrate

# Seed roles and permissions (idempotent)
npm run db:seed
```

Migrations live in `database/migrations/`. Never edit generated SQL files manually —
modify the Drizzle schema in `src/shared/database/schema/` and regenerate.

## Soft deletes

`users` and `workspaces` have a `deleted_at` column. Queries must filter
`WHERE deleted_at IS NULL` for active records. Foreign keys on child tables use
`ON DELETE CASCADE` (tokens) or `ON DELETE SET NULL` (audit logs) as appropriate.

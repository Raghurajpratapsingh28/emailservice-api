# Security Model

## Threat mitigations

### Authentication

| Threat | Mitigation |
|--------|-----------|
| Password brute force | bcrypt cost 12; per-IP + per-email rate limits (Redis); account lockout with sliding-window decay |
| Credential stuffing | Per-email rate limit independent of IP; lockout counter |
| User enumeration on login | Always run bcrypt compare (fixed dummy hash) regardless of whether user exists |
| User enumeration on forgot-password | Always return 202; run dummy bcrypt compare for timing parity |
| Weak password | Zod schema enforces ≥12 chars, uppercase, lowercase, digit, special char |
| Password hash leak | bcrypt; `passwordHash` never returned in any response; redacted from logs |
| Stale access tokens after logout | JTI denylist in Redis (TTL = remaining token lifetime) |
| Stale access tokens after password change | `iat < passwordChangedAt` check in `authenticate` — no Redis lookup needed |
| Refresh token replay | Opaque tokens stored as SHA-256 hash; rotation with row-level lock (`SELECT … FOR UPDATE`) |
| Refresh token theft + reuse | Family revocation on reuse detection; 30s grace window for legit concurrent clients |
| Concurrent refresh race | `SELECT … FOR UPDATE` serializes concurrent rotations on the same row |
| Session sprawl | Max 10 active sessions per user; oldest revoked on overflow |
| Cross-user refresh revocation | `revokeByPlaintext` requires owner `userId` in WHERE clause |

### Authorization

| Threat | Mitigation |
|--------|-----------|
| Workspace isolation bypass | `workspaceGuard` validates membership on every request; workspace id from header only (not query string) |
| Privilege escalation via invite | Invited role must have strictly lower `ROLE_WEIGHT` than inviter |
| Account takeover via invite | Accepting an invite for an existing email requires authentication as that user |
| IDOR on sessions | `revokeSession` WHERE includes `user_id = authedUser.id` |
| IDOR on workspace members | `findMembershipById` always pairs `membershipId` with `workspaceId` in WHERE |
| IDOR on domains | `findById` / `findByDomain` always pair `id` with `workspaceId` in WHERE — cross-tenant lookup returns 404, not 403 (no existence leak) |
| RBAC cache stale across replicas | Redis pub/sub channel `rbac:invalidate`; all replicas subscribe and drop their cache key |
| Permission bypass via URL workspace id | Workspace id accepted only from `x-workspace-id` header or explicit path param; query string removed |
| Privilege escalation via role update | `updateMemberRole` enforces `ROLE_WEIGHT[actorRole] > ROLE_WEIGHT[targetRole]` AND `ROLE_WEIGHT[actorRole] > ROLE_WEIGHT[newRole]` |
| Owner demotion via PATCH | Owner role cannot be changed via PATCH; only via `transfer-ownership` |
| Sole-owner removal | `countOwners(excludeUserId)` checked before any member deletion |
| Self-lockout | Actor cannot change their own role or remove themselves |
| Stale workspace access after deactivation | `assertActive()` guard on every mutating service method; RBAC cache invalidated on deactivate |
| Optimistic concurrency bypass | `updateWithVersion` uses `WHERE version = expectedVersion`; returns null on mismatch → 409 |
| Cross-workspace member mutation | `deleteMembership` / `findMembershipById` always include `workspaceId` in WHERE |
| Domain zombie rows on SES failure | `createDomain` hard-deletes the DB row inside a transaction if SES `CreateEmailIdentity` throws; best-effort SES `DeleteEmailIdentity` also called |

### Infrastructure

| Threat | Mitigation |
|--------|-----------|
| IP spoofing via X-Forwarded-For | `TRUST_PROXY` accepts CIDR list / hop count; `true` maps to loopback only |
| Secret leakage in logs | pino redact list covers `authorization`, `cookie`, `x-internal-key`, `body.password`, `body.refreshToken`, `body.token` |
| Internal endpoint exposure | `/metrics` guarded by `x-internal-key` (timing-safe compare) |
| Oversized payloads | `bodyLimit` enforced at Fastify level (default 1 MB) |
| Clickjacking / framing | Helmet `frameAncestors: ["'none'"]` |
| MIME sniffing | Helmet `noSniff` |
| HSTS | 1-year max-age, includeSubDomains, preload |

---

## Token security properties

- Refresh tokens are **48 bytes of CSPRNG output** (384 bits), base64url-encoded. SHA-256 hash stored in DB. Plaintext never persisted.
- Access tokens are **HS256 JWTs** with `iss`, `aud`, `exp`, `iat`, `jti` claims. `jti` equals the `refresh_tokens.id` row, enabling O(1) revocation.
- Password reset and email verification tokens are also 48-byte opaque tokens, stored hashed, single-use, with expiry.
- Invite tokens: same design. Accepting an invite consumes the token atomically inside a `SELECT … FOR UPDATE` transaction.
- Workspace switch issues a fresh access token with a `ws` claim (workspace id). The refresh token is **not** rotated — workspace switching is not a session-level event.

---

## Workspace security model

### Tenant isolation

Every workspace-scoped query in the repository layer requires `workspaceId` as a mandatory first argument. There is no repository method that returns workspace-scoped data without that filter.

The `workspaceGuard` middleware:
1. Reads workspace id from `x-workspace-id` header (or explicit path param — never query string).
2. Validates UUID shape before any DB call.
3. Looks up the workspace (must exist and not be soft-deleted).
4. Resolves the user's membership via `RbacService` (Redis-cached, 60s TTL).
5. Sets `request.workspace` and `request.permissions` — downstream handlers never re-query membership.

### Role hierarchy enforcement

```
owner (100) > admin (75) > member (50) > viewer (25)
```

All role-changing operations enforce:
- Actor weight > target's current role weight
- Actor weight > new role weight

This prevents admins from promoting peers to admin or above.

### Ownership transfer

The only way to assign the `owner` role is via `POST /:workspaceId/transfer-ownership`. This endpoint:
- Requires the caller to be the current owner.
- Requires the target to already be a workspace member.
- Runs atomically: promotes target, demotes caller to admin, updates `workspaces.ownerUserId`, bumps `version`.
- Invalidates RBAC cache for both users.

### Deactivation

A deactivated workspace (`status = 'inactive'`) blocks all mutating operations via `assertActive()`. Read operations still work. Only `reactivate` is allowed. The RBAC cache for all members is invalidated on deactivation.

---

## Audit log

Every security-sensitive action writes a row to `audit_logs`:

```
auth.signup, auth.login.success, auth.login.failure, auth.login.locked,
auth.logout, auth.logout_all, auth.refresh.success, auth.refresh.failure,
auth.refresh.reuse_detected, auth.password.reset_requested,
auth.password.reset_completed, auth.email.verification_sent,
auth.email.verified, auth.invite.sent, auth.invite.accepted,
auth.session.revoked, rbac.permission.denied,
workspace.created, workspace.member.added, workspace.member.removed
```

Workspace mutations (update, settings change, role change, ownership transfer, deactivate, reactivate) are also recorded with a `metadata.kind` discriminator.

Audit writes are **best-effort** — a write failure is logged but never fails the user-facing request. `metadata` is `jsonb` for structured SIEM ingestion. `requestId` correlates with HTTP access logs.

---

## Metrics

Prometheus counters exposed at `GET /metrics` (internal-auth required):

| Metric | Labels |
|--------|--------|
| `auth_login_attempts_total` | `outcome`: success, invalid_credentials, locked, disabled |
| `auth_refresh_outcomes_total` | `outcome`: success, invalid, expired, reuse, grace |
| `auth_token_revocations_total` | `kind`: refresh/access; `reason`: logout, password_reset, family_compromised, … |
| `auth_permission_denials_total` | `workspace_role` |
| `auth_password_ops_total` | `op`: forgot/reset/change; `outcome`: success, invalid, user_not_found |
| `auth_bcrypt_duration_seconds` | `op` |
| `domains_created_total` | `plan` |
| `domains_ses_failures_total` | `op`: create, get, delete, dkim |
| `domains_queue_publishes_total` | `subject` |
| `emails_transactional_queued_total` | `workspace_plan`, `used_template` |
| `emails_transactional_queue_publish_failures_total` | — |
| `emails_template_usage_total` | `template_name` |
| `emails_idempotency_hits_total` | — |
| `campaigns_created_total` | `type` |
| `campaigns_scheduled_total` | — |
| `campaigns_send_triggers_total` | `outcome`: queued, rollback, empty_audience |
| `campaigns_transition_failures_total` | `from`, `to` |

---

## Dependency security notes

- `bcrypt` cost factor is configurable (`BCRYPT_ROUNDS`, min 4 for tests, default 12 in production).
- `jsonwebtoken` is used with explicit `algorithms: ['HS256']` to prevent algorithm confusion.
- `@fastify/jwt` is configured with the same `iss`/`aud` constraints.
- All token comparisons use SHA-256 hash equality (DB lookup) or `timingSafeEqual` (internal API key).
- Workspace slug suffixes use `generateRandomHex` (CSPRNG) — not `Math.random`.

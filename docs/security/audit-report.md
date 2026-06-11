# EngageIQ API — Security Audit Report

**Scope:** Full codebase (all TypeScript source files, config, docs)
**Date:** 2026-06-09
**Total Findings:** 35 (4 Critical · 8 High · 10 Medium · 7 Low · 6 Informational)

---

## Summary Table

| ID | Severity | Title | File |
|----|----------|-------|------|
| CRIT-1 | CRITICAL | Real API key committed to docs | `docs/api/testing-commands.md:24` |
| CRIT-2 | CRITICAL | SQL injection via unsanitized `propKey` | `src/jobs/processors/segment-refresh.processor.ts:178` |
| CRIT-3 | CRITICAL | Swagger UI enabled by default in production | `src/config/index.ts:76` |
| CRIT-4 | CRITICAL | Database SSL disabled by default | `src/config/index.ts:35` |
| HIGH-1 | HIGH | Internal API key accepted via query string | `src/http/middleware/internal-auth.ts:14` |
| HIGH-2 | HIGH | Missing Zod validation on `updateProfile` / `changePassword` | `src/modules/auth/controllers/auth.controller.ts:137` |
| HIGH-3 | HIGH | No rate limiting on `changePassword` | `src/modules/auth/routes.ts:141` |
| HIGH-4 | HIGH | `changePassword` does not revoke all sessions | `src/modules/auth/services/auth.service.ts:1040` |
| HIGH-5 | HIGH | Hardcoded 900s TTL in JTI denylist | `src/modules/auth/services/auth.service.ts:1046` |
| HIGH-6 | HIGH | Rate limiting fails open on Redis failure | `src/http/middleware/rate-limit.ts:51` |
| HIGH-7 | HIGH | `suppressContact` / `unsuppressContact` missing audit logs | `src/modules/contacts/services/contact.service.ts:288` |
| HIGH-8 | HIGH | Audit action field misused for unrelated events | `src/modules/workspaces/services/workspace.service.ts` |
| MED-1 | MEDIUM | JTI denylist skipped when `jti` claim absent | `src/http/middleware/authenticate.ts:59` |
| MED-2 | MEDIUM | `TRUST_PROXY` boolean vs string ambiguity | `src/config/index.ts:13` |
| MED-3 | MEDIUM | `unsafe-inline` CSP applied globally | `src/app/app.ts:95` |
| MED-4 | MEDIUM | No per-user rate limit on `resendVerification` | `src/modules/auth/routes.ts:127` |
| MED-5 | MEDIUM | Unbounded recursion in `filterTree` processing | `src/jobs/processors/segment-refresh.processor.ts:83` |
| MED-6 | MEDIUM | DMARC defaults to `p=none` with no upgrade path | `src/modules/domains/services/domain.service.ts:386` |
| MED-7 | MEDIUM | `filterTree` not re-validated in segment worker | `src/jobs/processors/segment-refresh.processor.ts:46` |
| MED-8 | MEDIUM | Idempotency key not scoped to actor | `src/shared/cache/idempotency.ts:69` |
| MED-9 | MEDIUM | Stripe webhook replay returns HTTP 200 on rejection | `src/modules/billing/stripe-webhook.handler.ts:59` |
| MED-10 | MEDIUM | Workspace-switch tokens cannot be revoked | `src/modules/workspaces/services/workspace.service.ts:257` |
| LOW-1 | LOW | Account lockout threshold permissive (10 attempts) | `src/config/index.ts:55` |
| LOW-2 | LOW | Opaque tokens use plain SHA-256 without HMAC pepper | `src/shared/utils/tokens.ts:20` |
| LOW-3 | LOW | Email template renderer does not HTML-escape values | `src/modules/transactional/services/transactional.service.ts:577` |
| LOW-4 | LOW | bcrypt 72-byte truncation not guarded | `src/shared/utils/password.ts:7` |
| LOW-5 | LOW | `filterTree` JSON size not bounded | `src/modules/segments/services/segment.service.ts:66` |
| LOW-6 | LOW | `getContact` + tags are non-atomic reads (TOCTOU) | `src/modules/contacts/services/contact.service.ts:170` |
| LOW-7 | LOW | `filterTree` numeric value type confusion | `src/jobs/processors/segment-refresh.processor.ts:13` |
| INFO-1 | INFO | `DUMMY_BCRYPT_HASH` hardcoded without explanation | `src/modules/auth/services/auth.service.ts:87` |
| INFO-2 | INFO | NATS connection has no auth or TLS | `src/shared/queue/nats.ts:18` |
| INFO-3 | INFO | Prometheus metrics served on public port | `src/app/app.ts:127` |
| INFO-4 | INFO | Idempotency TOCTOU window allows duplicate sends | `src/shared/cache/idempotency.ts:86` |
| INFO-5 | INFO | `ipAddress` in audit logs not validated | `src/modules/auth/services/audit.service.ts:97` |
| INFO-6 | INFO | `updateProfile` and `changePassword` missing audit entries | `src/modules/auth/controllers/auth.controller.ts:133` |

---

## CRITICAL

---

### CRIT-1 — Real Internal API Key Committed to Docs

**File:** `docs/api/testing-commands.md:24`

A 64-character hex string that appears to be an actual `INTERNAL_API_KEY` value is hardcoded in a git-tracked documentation file.

```md
curl "http://localhost:4000/metrics?key=4fee8a4641dffe853649f070ce15336d34c181fed2470a348a33e171d80b30b4"
```

**Impact:** Anyone with repository access can use this key to access the `/metrics` endpoint and all other internal routes.

**Fix:**
- Rotate the key immediately via `openssl rand -hex 32`
- Replace the value in the doc with `<YOUR_INTERNAL_API_KEY>`
- Add `trufflehog`, `detect-secrets`, or `git-secrets` as a pre-commit hook to prevent future leaks

---

### CRIT-2 — SQL Injection via Unsanitized `propKey` in Segment Processor

**File:** `src/jobs/processors/segment-refresh.processor.ts:178–203`

`propKey` is derived from user-controlled segment filter data and injected directly into Drizzle `sql` template literals as a raw SQL fragment rather than as a parameterized value.

```ts
// propKey = field.slice('properties.'.length) — from untrusted input
return sql`${contacts.properties}->>${propKey} = ${String(value)}`; // INJECTION
return sql`${contacts.properties} ? ${propKey}`;                    // INJECTION
return sql`NOT (${contacts.properties} ? ${propKey})`;              // INJECTION
```

A segment filter with `field: "properties.' OR 1=1 --"` can manipulate the resulting SQL.

**Impact:** Potential data exfiltration, unauthorized data access, or query manipulation across all contacts in a workspace.

**Fix:**
```ts
// Validate propKey before any SQL use
const PROP_KEY_RE = /^[a-zA-Z0-9_]{1,64}$/;
if (!PROP_KEY_RE.test(propKey)) {
  throw new Error(`Invalid property key: ${propKey}`);
}
```

---

### CRIT-3 — Swagger UI Enabled by Default in Production

**File:** `src/config/index.ts:76`

```ts
SWAGGER_ENABLED: z.union([z.string(), z.boolean()])
  .transform(...)
  .default(true),  // ← exposes full API docs in every default deployment
```

Every production deployment exposes full API documentation including all endpoint paths, parameter schemas, authentication flows, and error codes at `/docs`.

**Impact:** Eliminates reconnaissance effort for attackers; surfaces internal API design, error code patterns, and auth scheme details.

**Fix:**
```ts
.default(false) // operators must explicitly enable

// Also enforce in app bootstrap:
if (config.SWAGGER_ENABLED && config.NODE_ENV === 'production') {
  throw new Error('SWAGGER_ENABLED must be false in production');
}
```

---

### CRIT-4 — Database SSL Disabled by Default

**File:** `src/config/index.ts:35` / `src/shared/database/client.ts:33`

```ts
DATABASE_SSL: z.union([z.string(), z.boolean()])
  .transform(...)
  .default(false),  // ← plaintext DB connections in every default deployment
```

All database traffic is transmitted in cleartext unless the operator explicitly sets `DATABASE_SSL=true`.

**Impact:** In any cloud deployment (RDS, Cloud SQL, etc.), DB credentials and all application data are exposed to network-level interception.

**Fix:**
```ts
.default(true) // operators must explicitly opt out for local dev
```

---

## HIGH

---

### HIGH-1 — Internal API Key Accepted via Query String

**File:** `src/http/middleware/internal-auth.ts:14–16`

```ts
const fromQuery = (req.query as Record<string, string | undefined>)['key'];
const presented = typeof fromHeader === 'string' ? fromHeader : (fromQuery ?? '');
```

Query strings appear in every proxy log, CDN edge log, web server access log, and browser history. The secret key is permanently recorded in plaintext.

**Impact:** Any party with access to server or proxy access logs can recover the internal API key.

**Fix:** Remove the `fromQuery` fallback entirely. Enforce header-only delivery:

```ts
const presented = req.headers['x-internal-key'] ?? '';
```

---

### HIGH-2 — Missing Zod Validation on `updateProfile` / `changePassword`

**File:** `src/modules/auth/controllers/auth.controller.ts:137–156`

```ts
// No Zod parse — raw type cast only
const body = req.body as { firstName?: string; lastName?: string };
const body = req.body as { currentPassword: string; newPassword: string };
```

Both handlers bypass the schema enforcement applied to all other endpoints. Extra fields pass through to the service layer, creating a mass-assignment vector.

**Fix:** Add schemas to `auth.schema.ts` and parse at the start of each handler:

```ts
const body = updateProfileBodySchema.parse(req.body);
const body = changePasswordBodySchema.parse(req.body);
```

---

### HIGH-3 — No Rate Limiting on `changePassword`

**File:** `src/modules/auth/routes.ts:141–177`

```ts
app.post('/change-password', {
  preHandler: [app.authenticate],  // ← no rate limit
  ...
}, authController.changePassword);
```

An attacker with a valid session token can brute-force the current password at approximately 200 attempts/minute (bcrypt cost 12 limits speed), completely bypassing the login lockout that guards `/auth/login`.

**Fix:** Apply a strict per-userId rate limit (e.g. 5 attempts / 15 min):

```ts
preHandler: [app.authenticate, rateLimitByUser({ max: 5, window: '15m' })],
```

---

### HIGH-4 — `changePassword` Does Not Revoke All Sessions

**File:** `src/modules/auth/services/auth.service.ts:1040–1048`

On password change, refresh tokens are revoked in the DB but without `RETURNING`, so their `jti` values are never collected for Redis denylist. Only the current session's access token is revoked. All other active sessions remain valid for up to `JWT_ACCESS_TTL` (default 15 minutes).

```ts
await this.db
  .update(refreshTokens)
  .set({ revokedAt: now, revokedReason: 'password_reset' })
  .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
// ← no .returning(), jtis never captured

if (ctx.accessJti) {
  await this.tokens.denylistAccessJti(ctx.accessJti, 900); // only current session
}
```

Compare to `resetPassword` which correctly calls `revokeAllForUser()` → `denylistAccessJtis()`.

**Fix:** Mirror the `resetPassword` pattern:

```ts
const revoked = await this.tokens.revokeAllForUser(userId, 'password_changed');
await this.tokens.denylistAccessJtis(revoked, parseDurationToSeconds(config.JWT_ACCESS_TTL));
```

---

### HIGH-5 — Hardcoded 900s TTL in JTI Denylist for `changePassword`

**File:** `src/modules/auth/services/auth.service.ts:1046`

```ts
await this.tokens.denylistAccessJti(ctx.accessJti, 900); // hardcoded seconds
```

If `JWT_ACCESS_TTL` is changed in config (e.g. extended to 30 or 60 minutes), the denylist entry expires before the JWT itself, creating a window where a revoked token is accepted.

**Fix:**
```ts
await this.tokens.denylistAccessJti(ctx.accessJti, parseDurationToSeconds(config.JWT_ACCESS_TTL));
```

---

### HIGH-6 — Rate Limiting Fails Open on Redis Failure

**File:** `src/http/middleware/rate-limit.ts:51–55`

```ts
if (!results) {
  req.log.warn({ bucket }, '[rate-limit] redis pipeline empty');
  return; // ← all requests allowed through when Redis is unreachable
}
```

A Redis outage (or intentional DoS against Redis) completely disables all rate limiting, including brute-force protection on authentication endpoints.

**Fix:** For auth-critical endpoints, fail closed:

```ts
if (!results) {
  req.log.error({ bucket }, '[rate-limit] redis unreachable — rejecting request');
  throw new ServiceUnavailableError('Rate limiter unavailable');
}
```

---

### HIGH-7 — `suppressContact` / `unsuppressContact` Missing Audit Logs

**File:** `src/modules/contacts/services/contact.service.ts:288–309`

Suppression state changes directly affect GDPR/CAN-SPAM compliance and email deliverability. Both methods mutate contact state without recording any audit log entry, while all other contact mutations (`createContact`, `updateContact`, `deleteContact`) are audited.

**Fix:**
```ts
await this.audit.record({
  action: 'contact.suppressed', // or 'contact.unsuppressed'
  workspaceId,
  actorId: actor?.id,
  resourceId: id,
  metadata: { emailSuppressed: true },
});
```

---

### HIGH-8 — Audit Action Field Misused for Unrelated Events

**Files:** `src/modules/workspaces/services/workspace.service.ts`, `src/modules/transactional/services/transactional.service.ts`, `src/modules/domains/services/domain.service.ts`

Many unrelated operations (workspace updates, ownership transfers, domain creation, email sends, template operations) all emit `action: 'workspace.member.added'` and rely solely on `metadata.kind` to differentiate them.

**Impact:** SIEM rules keyed on `action` values produce false positives / miss real events. Compliance reports are unreliable. Incident investigation is impeded.

**Fix:** Define and use the correct action per operation:

```
workspace.updated        — workspace name/slug/settings changes
workspace.deactivated    — workspace deactivation
workspace.reactivated    — workspace reactivation
workspace.ownership_transferred
domain.created           — domain identity added
domain.deleted           — domain identity removed
email.send.queued        — transactional email enqueued
email.template.created   — new template created
```

---

## MEDIUM

---

### MED-1 — JTI Denylist Check Skipped When `jti` Claim Absent

**File:** `src/http/middleware/authenticate.ts:59`

```ts
if (payload.jti) {
  const revoked = await req.server.services.jtiDenylist.isRevoked(payload.jti);
  // tokens without jti skip this check entirely
}
```

A token missing the `jti` claim bypasses revocation checks and can never be invalidated short of expiry. The `jti` field is typed as optional in `AccessTokenClaims`.

**Fix:** Treat a missing `jti` as an invalid token:

```ts
if (!payload.jti) throw new UnauthorizedError('Invalid token', 'TOKEN_INVALID');
const revoked = await req.server.services.jtiDenylist.isRevoked(payload.jti);
```

---

### MED-2 — `TRUST_PROXY` Boolean vs String Ambiguity

**File:** `src/config/index.ts:13`

The Zod default is the boolean `true`, but `resolveTrustProxy()` in `app.ts` converts the string `'true'` to loopback-only trust. The boolean `true` takes a different code path. The logic happens to work correctly at runtime (boolean `true` → `.toString()` → `"true"` → loopback), but a future refactor could silently break trust-proxy handling, re-enabling IP spoofing via `X-Forwarded-For`.

**Fix:** Use an unambiguous named Fastify value as default:

```ts
TRUST_PROXY: z.string().default('loopback'),
```

---

### MED-3 — `unsafe-inline` CSP Applied Globally

**File:** `src/app/app.ts:95`

```ts
scriptSrc: ["'self'", "'unsafe-inline'"],  // added for swagger-ui — applied to ALL routes
styleSrc:  ["'self'", "'unsafe-inline'"],
```

The permissive CSP required by Swagger UI is applied globally. If any route reflects user input in HTML (error pages, redirects), XSS mitigations via CSP are completely defeated.

**Fix:** Register Swagger UI on an isolated Fastify sub-instance with its own CSP. All non-Swagger routes should use a strict policy without `unsafe-inline`.

---

### MED-4 — No Per-User Rate Limit on `resendVerification`

**File:** `src/modules/auth/routes.ts:127`

The `resend-verification` endpoint applies a per-IP rate limit. Because it is authenticated, IP rotation bypasses the limit. An attacker controlling a compromised account can spam the victim's inbox with verification emails.

**Fix:** Key the rate limit on `req.authedUser.id` rather than (or in addition to) IP:

```ts
rateLimitByUser({ max: 3, window: '1h', keyFn: (req) => req.authedUser.id })
```

---

### MED-5 — Unbounded Recursion in `filterTree` Processing

**File:** `src/jobs/processors/segment-refresh.processor.ts:83`

```ts
private buildWhereClause(group: FilterGroup): SQL | undefined {
  for (const rule of group.rules) {
    if ('rules' in rule) {
      const nested = this.buildWhereClause(rule as FilterGroup); // ← unbounded
```

A deeply nested `filterTree` (e.g. 10,000 levels) causes a stack overflow or produces an enormous SQL query that degrades the database.

**Fix:** Validate depth and node count at segment creation time:

```ts
function validateFilterTree(group: FilterGroup, depth = 0, count = { n: 0 }) {
  if (depth > 5) throw new ValidationError('filterTree max depth is 5');
  if (++count.n > 50) throw new ValidationError('filterTree max 50 nodes');
  for (const rule of group.rules) {
    if ('rules' in rule) validateFilterTree(rule as FilterGroup, depth + 1, count);
  }
}
```

---

### MED-6 — DMARC Defaults to `p=none` (Monitoring Only)

**File:** `src/modules/domains/services/domain.service.ts:386`

```ts
value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}; ...`
```

`p=none` means DMARC failures are reported but not acted on. Customers' domains remain vulnerable to email spoofing / phishing even after full DKIM/SPF setup.

**Fix:** Default to `p=quarantine` or surface a prominent warning that `p=none` does not prevent spoofing, with a documented upgrade path to `p=reject`.

---

### MED-7 — `filterTree` Not Re-Validated in Segment Worker

**File:** `src/jobs/processors/segment-refresh.processor.ts:46`

```ts
const filterTree = segment.filterTree as FilterGroup; // cast, no validation
```

The worker trusts data from the database without re-validating it. Malformed or tampered `filterTree` data (from a NATS message or direct DB write) bypasses any API-layer validation.

**Fix:** Parse `filterTree` through the same Zod schema used at the API layer before passing it to `buildWhereClause`. Unknown `operator` values currently log warnings and continue — they should instead abort processing for that segment.

---

### MED-8 — Idempotency Key Not Scoped to Actor

**File:** `src/shared/cache/idempotency.ts:69`

The Redis key is `idempotency:{workspaceId}:{clientKey}`. Any workspace member with `email.write` permission who guesses another member's idempotency key (e.g. `signup-alice-1`) receives the cached response from that earlier request, including the `sendId`.

**Fix:** Include the actor's user ID in the cache key:

```ts
const key = `idempotency:${workspaceId}:${actorUserId}:${clientKey}`;
```

---

### MED-9 — Stripe Webhook Replay Returns HTTP 200 on Rejection

**File:** `src/modules/billing/stripe-webhook.handler.ts:59`

The secondary age check rejects replayed events but returns `{ received: true }` (HTTP 200). The secondary check is also redundant — the Stripe SDK's `constructEvent` already enforces a 300-second tolerance. Returning 200 for a rejected event silently drops it rather than triggering a Stripe retry.

**Fix:** Remove the redundant secondary check. If intentional silent-drop behavior is desired for old events, add a clear comment explaining why HTTP 200 is correct here (prevents exponential Stripe retries for genuinely stale events).

---

### MED-10 — Workspace-Switch Tokens Cannot Be Revoked

**File:** `src/modules/workspaces/services/workspace.service.ts:257`

```ts
const accessToken = signAccessToken({
  sub: actor.user.id,
  jti: ctx.membershipId,  // ← stable value, not tracked in refresh_tokens
  ws: ws.id,
});
```

Workspace-switch access tokens use `membershipId` as `jti`. Since `membershipId` is not tracked in the `refresh_tokens` table, these tokens cannot be individually revoked. Logout and password-change operations do not denylist them.

**Fix:** Generate a fresh `randomUUID()` as `jti` and either persist a short-lived Redis record for revocability, or explicitly document this as an accepted risk with a comment.

---

## LOW

---

### LOW-1 — Account Lockout Threshold Is Permissive

**File:** `src/config/index.ts:55`

Default of 10 failed attempts per 15-minute window allows testing 10 passwords per email address before lockout, per IP. Combined with the rate limit ceiling this provides meaningful credential-stuffing headroom.

**Fix:** Reduce default to 5 attempts. Consider adaptive lockout (shorter window after repeated lockouts).

---

### LOW-2 — Opaque Tokens Use Plain SHA-256 (No HMAC Pepper)

**File:** `src/shared/utils/tokens.ts:20`

Password-reset, invite, and email-verification tokens are stored as `SHA-256(plaintext)`. If the database is compromised, an attacker can verify a known token against stored hashes without a server-side secret.

**Fix:** Use `HMAC-SHA256(TOKEN_HMAC_SECRET, plaintext)` so offline verification requires the server secret:

```ts
createHmac('sha256', config.TOKEN_HMAC_SECRET).update(plaintext).digest('hex');
```

---

### LOW-3 — Email Template Renderer Does Not HTML-Escape Values

**File:** `src/modules/transactional/services/transactional.service.ts:577`

```ts
return value === null || value === undefined ? '' : String(value); // no escaping
```

`templateData` values like `<script>alert(1)</script>` are inserted verbatim into the HTML email body. Some email clients execute scripts; malformed HTML can also break email rendering.

**Fix:** Apply HTML entity escaping to all interpolated values:

```ts
const escape = (s: string) =>
  s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
   .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
return escape(String(value));
```

---

### LOW-4 — bcrypt 72-Byte Truncation Not Guarded

**File:** `src/shared/utils/password.ts:7`

bcrypt silently truncates input at 72 bytes. A password `"a".repeat(72) + "different"` is treated identically to `"a".repeat(72)`. This is a well-known library limitation that is not surfaced to users.

**Fix:** Pre-hash passwords longer than 72 bytes (SHA-256 → base64url → bcrypt), or enforce a maximum password length of 72 characters with a clear validation error at the schema layer.

---

### LOW-5 — `filterTree` JSON Size Not Bounded at Write Time

**File:** `src/modules/segments/services/segment.service.ts:66`

The `filterTree` field is stored as a JSONB column without explicit size validation. A user could submit very large trees that inflate storage and slow JSONB parsing.

**Fix:** Add a Zod `.superRefine()` check:

```ts
.superRefine((tree, ctx) => {
  if (JSON.stringify(tree).length > 65_536) {
    ctx.addIssue({ code: 'too_big', message: 'filterTree exceeds 64KB limit' });
  }
})
```

---

### LOW-6 — `getContact` + Tag Query Are Non-Atomic (TOCTOU)

**File:** `src/modules/contacts/services/contact.service.ts:170`

`getContact` fetches the contact and then fetches its tags in two separate queries without a transaction. A concurrent contact deletion between the two queries returns orphaned tag data for a non-existent contact.

**Fix:** Wrap both queries in a `db.transaction()` block or use a single JOIN.

---

### LOW-7 — `filterTree` Numeric Value Type Confusion

**File:** `src/jobs/processors/segment-refresh.processor.ts:13`

The `FilterRule.value` accepts `string | number` but numeric operators build `sql\`...::numeric > ${value}\`` without validating that `value` is actually numeric. The PostgreSQL `::numeric` cast rejects non-numeric strings cleanly, but this relies on DB-level error handling rather than explicit validation.

**Fix:** Strictly validate `value` as a finite number for `greater_than` / `less_than` operators before building SQL, rather than relying on PostgreSQL to reject the input.

---

## INFORMATIONAL

---

### INFO-1 — `DUMMY_BCRYPT_HASH` Hardcoded Without Sufficient Explanation

**File:** `src/modules/auth/services/auth.service.ts:87`

The constant is correctly used (timing-safe compare when user does not exist), but a future developer may mistake it for a real credential or remove it, breaking the timing-safe path.

**Recommendation:** Expand the comment to explicitly note: "This is intentionally hardcoded and never represents a real user credential. It exists solely to run bcrypt.compare() for timing parity when the requested user is not found."

---

### INFO-2 — NATS Connection Has No Authentication or TLS

**File:** `src/shared/queue/nats.ts:18`

The NATS connection is established with only `servers` and `name` — no credentials, NKey, JWT token, or TLS. Any process on the same network can publish to any NATS subject including `auth.user.registered`, `workflow.register`, and `events.raw.*`.

**Recommendation:** Add NKey or JWT authentication via the `authenticator` option. Use `tls://` scheme for the NATS URL and configure certificate validation.

---

### INFO-3 — Prometheus Metrics Served on Public Port

**File:** `src/app/app.ts:127`

The `/metrics` endpoint is co-located with public API traffic on the same port. A compromised internal API key exposes metrics data. Prometheus metrics are conventionally served on a separate loopback-only port.

**Recommendation:** Move metrics to a separate Fastify instance bound to `127.0.0.1:9091`, or enforce network-layer access control (security groups) restricting `/metrics` to the Prometheus scrape IP only.

---

### INFO-4 — Idempotency TOCTOU Window Allows Duplicate Email Sends

**File:** `src/shared/cache/idempotency.ts:86`

Two concurrent identical requests can both observe a cache miss from `checkOrReserve`, both proceed to send the email, and the second overwrites the first response in `storeResponse`. The `SET NX` reservation reduces but does not eliminate this window.

**Recommendation:** Wrap the reserve + send + store sequence in a Lua script for atomic reserve-or-return behavior, or document this as an accepted race condition with a known maximum duplicate window.

---

### INFO-5 — `ipAddress` in Audit Logs Not Validated

**File:** `src/modules/auth/services/audit.service.ts:97`

The `ipAddress` field is truncated to 64 characters but not validated as a proper IPv4/IPv6 address. A spoofed `X-Forwarded-For` header with special characters could store unexpected values in the audit log.

**Recommendation:** Validate `ipAddress` against an IPv4/IPv6 regex before storage. Sanitize `userAgent` to printable ASCII only.

---

### INFO-6 — Profile Update and Password Change Missing Audit Entries

**File:** `src/modules/auth/controllers/auth.controller.ts:133–156`

`updateProfile` and `changePassword` (authenticated endpoint) do not emit any audit log entries. The `resetPassword` flow in the service layer correctly audits, but the direct `changePassword` path does not.

**Recommendation:** Add `audit.record()` calls:

```ts
await audit.record({ action: 'auth.password.changed', userId: req.authedUser.id, ... });
await audit.record({ action: 'auth.profile.updated', userId: req.authedUser.id, ... });
```

---

## Remediation Priority

### Immediate — Before Next Deployment

1. **Rotate the committed internal API key** (CRIT-1 / INFO-7) — regenerate via `openssl rand -hex 32`
2. **Remove query-string key acceptance** (HIGH-1) — header only
3. **Fix SQL injection in segment processor** (CRIT-2) — allowlist `propKey`
4. **Flip `SWAGGER_ENABLED` default to `false`** (CRIT-3)
5. **Flip `DATABASE_SSL` default to `true`** (CRIT-4)

### Next Sprint

- HIGH-2: Add Zod validation to `updateProfile` / `changePassword`
- HIGH-3: Rate limit `changePassword` by userId
- HIGH-4: Revoke all sessions on password change
- HIGH-5: Fix hardcoded 900s TTL
- HIGH-6: Fail closed on Redis failure for auth rate limits
- HIGH-7: Add audit logs to suppress/unsuppress contact
- HIGH-8: Fix audit action field misuse
- MED-1: Enforce `jti` as required JWT claim
- MED-3: Scope `unsafe-inline` CSP to Swagger routes only
- MED-5: Add `filterTree` depth and node count limits

### Backlog

- Remaining MEDIUM items (MED-2, MED-4, MED-6 through MED-10)
- All LOW items
- All INFORMATIONAL items

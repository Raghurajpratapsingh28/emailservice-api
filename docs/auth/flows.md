# Authentication Flows

## Token design

| Token | Type | TTL | Storage |
|-------|------|-----|---------|
| Access token | JWT (HS256) | 15 min | Client memory only — never in localStorage |
| Refresh token | Opaque (48-byte random, base64url) | 30 days | HttpOnly cookie or secure client storage |

**Access token claims:**
```json
{ "sub": "user-id", "email": "...", "type": "access", "jti": "refresh-row-id", "iat": 1234, "exp": 1234, "iss": "engageiq", "aud": "engageiq-api" }
```

The `jti` equals the `refresh_tokens.id` row that was active when the access token was issued.
This allows instant revocation via the Redis denylist.

---

## Signup flow

```
Client                          API
  │── POST /auth/signup ────────►│
  │                              │ 1. Validate email uniqueness (txn)
  │                              │ 2. Hash password (bcrypt, cost 12)
  │                              │ 3. Insert user + workspace + owner membership
  │                              │ 4. Issue email verification token (async)
  │                              │ 5. Issue access + refresh token pair
  │◄── 201 { user, workspace, tokens } ──│
```

---

## Login flow

```
Client                          API
  │── POST /auth/login ─────────►│
  │                              │ 1. Lookup user by emailNormalized
  │                              │ 2. bcrypt.compare (always runs, even if user not found)
  │                              │ 3. Check account lockout
  │                              │ 4. On failure: increment sliding-window counter
  │                              │ 5. On success: reset counter, update lastLoginAt
  │                              │ 6. Opportunistic bcrypt rehash if cost changed
  │                              │ 7. Issue token pair
  │◄── 200 { tokens } ──────────│
```

**Account lockout:** After `ACCOUNT_LOCKOUT_MAX_ATTEMPTS` (default 10) failures within
`ACCOUNT_LOCKOUT_WINDOW_S` (default 900s), the account is locked for
`ACCOUNT_LOCKOUT_DURATION_S` (default 900s). The counter decays automatically — a
quiet period resets it.

---

## Refresh token rotation

```
Client                          API
  │── POST /auth/refresh ────────►│
  │                              │ 1. Hash presented token
  │                              │ 2. SELECT … FOR UPDATE (row lock)
  │                              │ 3a. Token active → issue new pair, revoke old
  │                              │ 3b. Token in grace window (≤30s after rotation) → re-rotate
  │                              │ 3c. Token already revoked → REUSE: kill entire family
  │◄── 200 { tokens } ──────────│
```

**Rotation grace window:** If a client presents the immediately-prior token within 30
seconds of rotation (e.g. two tabs refreshing simultaneously), the request succeeds
without killing the family. This prevents false-positive `TOKEN_REUSE` errors on
flaky networks.

**Reuse detection:** If a revoked token is presented outside the grace window, the
entire token family is revoked (all sessions sharing the same `familyId`). This
limits the blast radius of a stolen refresh token.

---

## Logout flow

```
Client                          API
  │── POST /auth/logout ─────────►│
  │  Authorization: Bearer <at>   │ 1. Revoke refresh token (ownership-verified)
  │  body: { refreshToken }       │ 2. Add access token jti to Redis denylist (TTL = remaining lifetime)
  │◄── 204 ─────────────────────│
```

After logout, the access token is **immediately** rejected on the next request via the
Redis denylist check in `authenticate`. There is no 15-minute window.

---

## Password reset flow

```
Client                          API
  │── POST /auth/forgot-password ►│
  │                              │ 1. Lookup user (no enumeration — always 202)
  │                              │ 2. Issue 48-byte opaque token, store SHA-256 hash
  │                              │ 3. Publish email via NATS
  │◄── 202 ─────────────────────│

  │── POST /auth/reset-password ─►│
  │  body: { token, password }    │ 1. SELECT … FOR UPDATE on token row
  │                              │ 2. Validate not consumed, not expired, user isActive
  │                              │ 3. Hash new password, set passwordChangedAt = now()
  │                              │ 4. Consume token + invalidate all other reset tokens
  │                              │ 5. Revoke all refresh tokens + denylist access JWTs
  │◄── 200 ─────────────────────│
```

Setting `passwordChangedAt` kills all outstanding access tokens globally without
needing to enumerate them — `authenticate` rejects any token whose `iat < passwordChangedAt`.

---

## Invite flow

```
Inviter                         API                         Invitee
  │── POST /auth/invites ────────►│
  │  x-workspace-id: <id>         │ 1. Verify inviter has workspace.members.write
  │  body: { email, role }        │ 2. Enforce role hierarchy (invited < inviter weight)
  │                              │ 3. Revoke prior open invites for same email/workspace
  │                              │ 4. Insert invite row (hashed token)
  │                              │ 5. Publish invite email via NATS
  │◄── 201 { inviteId } ─────────│

                                                  │── POST /auth/accept-invite ──►│
                                                  │  body: { token, password? }   │ 1. Validate token (not consumed, not expired)
                                                  │                              │ 2a. Email matches existing user → require auth
                                                  │                              │ 2b. No existing user → create account
                                                  │                              │ 3. Add to workspace_members
                                                  │                              │ 4. Invalidate RBAC cache
                                                  │◄── 200 { workspaceId, tokens } ──│
```

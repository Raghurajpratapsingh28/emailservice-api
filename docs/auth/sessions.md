# Session Management

## Session model

Each login or signup creates a **session** — one row in `refresh_tokens`. A user can
have up to `MAX_SESSIONS_PER_USER` (default 10) active sessions simultaneously. When
the cap is exceeded, the oldest sessions are revoked automatically.

## Session lifecycle

```
Issue (login/signup)
  │
  ▼
Active ──── rotate ──► New active (old revoked, reason: 'rotated')
  │
  ├── logout ──────────► Revoked (reason: 'logout')
  ├── logout-all ────────► Revoked (reason: 'logout_all')
  ├── password reset ────► Revoked (reason: 'password_reset')
  ├── admin revoke ──────► Revoked (reason: 'user_revoked')
  ├── session cap ───────► Revoked (reason: 'session_cap')
  ├── family compromise ─► Revoked (reason: 'family_compromised')
  └── expiry (30d) ──────► Expired (not revoked, just past expiresAt)
```

## Access token revocation

Access tokens are short-lived (15 min) but can be revoked immediately via two mechanisms:

1. **JTI denylist** — on logout/revoke, the token's `jti` is written to Redis with a TTL
   equal to the token's remaining lifetime. Every authenticated request checks this.

2. **`passwordChangedAt` invariant** — `authenticate` rejects any access token whose
   `iat` (issued-at) is older than `users.passwordChangedAt`. Password reset kills all
   access tokens globally without touching Redis.

## Listing and revoking sessions

```
GET  /api/v1/auth/sessions          → list active sessions (current session flagged)
DELETE /api/v1/auth/sessions/:id    → revoke a specific session
POST /api/v1/auth/logout-all        → revoke all sessions
```

## Refresh token rotation grace window

To handle concurrent clients (e.g. mobile app + web tab both refreshing at startup),
the immediately-prior token in a family is accepted for **30 seconds** after rotation.
This prevents false-positive `TOKEN_REUSE` errors on flaky networks.

If the same token is presented **after** the grace window and the row is already revoked,
the entire token family is compromised and all sessions in that family are revoked.

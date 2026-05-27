# Auth API

All routes are under `/api/v1/auth`.

---

## POST /signup

Creates a user account and a default workspace. Issues an access + refresh token pair.

**Auth:** none  
**Rate limit:** per-IP

**Request body**
```json
{
  "email": "alice@example.com",
  "password": "GoodPass!2345A",
  "firstName": "Alice",
  "lastName": "Smith",
  "workspaceName": "Acme Corp"
}
```

Password rules: ≥12 chars, at least one uppercase, lowercase, digit, and special character.

**Response 201**
```json
{
  "user": { "id": "uuid", "email": "alice@example.com" },
  "workspace": { "id": "uuid", "slug": "acme-corp", "name": "Acme Corp" },
  "tokens": {
    "accessToken": "eyJ...",
    "refreshToken": "opaque-base64url",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

**Errors:** `EMAIL_TAKEN` 409

---

## POST /login

**Auth:** none  
**Rate limit:** per-IP + per-email

**Request body**
```json
{ "email": "alice@example.com", "password": "GoodPass!2345A" }
```

**Response 200** — same `tokens` shape as signup.

**Errors:** `INVALID_CREDENTIALS` 401, `ACCOUNT_LOCKED` 401, `ACCOUNT_DISABLED` 401

---

## POST /refresh

Rotates the refresh token. The old token is immediately revoked. A 30-second grace
window allows a single legit replay (e.g. concurrent mobile + web client).

**Auth:** none  
**Rate limit:** per-IP

**Request body**
```json
{ "refreshToken": "opaque-base64url" }
```

**Response 200** — same `tokens` shape.

**Errors:** `TOKEN_INVALID` 401, `TOKEN_REUSE` 401 (family revoked)

---

## POST /logout

Revokes the presented refresh token and immediately denylists the current access token.

**Auth:** Bearer  
**Request body**
```json
{ "refreshToken": "opaque-base64url" }
```

**Response 204**

---

## POST /logout-all

Revokes all active refresh tokens for the user and denylists all associated access tokens.

**Auth:** Bearer  
**Response 200**
```json
{ "revoked": 3 }
```

---

## POST /forgot-password

Queues a password-reset email. Always returns 202 regardless of whether the email exists
(no user enumeration).

**Auth:** none  
**Rate limit:** per-IP + per-email (max 5 per window per email)

**Request body**
```json
{ "email": "alice@example.com" }
```

**Response 202**
```json
{ "status": "accepted" }
```

---

## POST /reset-password

Consumes a password-reset token, updates the password, revokes all sessions.

**Auth:** none  
**Rate limit:** per-IP

**Request body**
```json
{
  "token": "opaque-base64url-from-email",
  "password": "NewSecure!Pass234"
}
```

**Response 200** `{ "status": "ok" }`

**Errors:** `TOKEN_INVALID` 401

---

## POST /verify-email

Confirms an email address using the token from the verification email.

**Auth:** none  
**Request body**
```json
{ "token": "opaque-base64url-from-email" }
```

**Response 200** `{ "status": "ok" }`

---

## POST /resend-verification

Re-sends the verification email for the authenticated user.

**Auth:** Bearer  
**Response 202** `{ "status": "accepted" }`

**Errors:** `EMAIL_ALREADY_VERIFIED` 409

---

## GET /me

Returns the authenticated user and their workspace memberships (max 50).

**Auth:** Bearer  
**Response 200**
```json
{
  "id": "uuid",
  "email": "alice@example.com",
  "firstName": "Alice",
  "lastName": "Smith",
  "isEmailVerified": true,
  "workspaces": [
    { "id": "uuid", "slug": "acme-corp", "name": "Acme Corp", "role": "owner" }
  ]
}
```

---

## GET /sessions

Lists active refresh-token sessions for the authenticated user.

**Auth:** Bearer  
**Response 200**
```json
{
  "items": [
    {
      "id": "uuid",
      "createdAt": "2026-05-25T10:00:00Z",
      "expiresAt": "2026-06-24T10:00:00Z",
      "ipAddress": "1.2.3.4",
      "userAgent": "Mozilla/5.0 ...",
      "current": true
    }
  ]
}
```

---

## DELETE /sessions/:sessionId

Revokes a specific session and denylists its access token.

**Auth:** Bearer  
**Response 204**

**Errors:** `NOT_FOUND` 404

---

## POST /invites

Invites a user to the active workspace. Inviter must have `workspace.members.write`
permission. Invited role must be strictly lower weight than the inviter's role.

**Auth:** Bearer + `x-workspace-id`  
**Required permission:** `workspace.members.write`

**Request body**
```json
{ "email": "bob@example.com", "role": "member" }
```

Valid roles: `admin`, `member`, `viewer` (never `owner`).

**Response 201**
```json
{ "inviteId": "uuid" }
```

**Errors:** `ALREADY_MEMBER` 409, `INVITE_ROLE_TOO_HIGH` 403

---

## POST /accept-invite

Accepts a workspace invitation.

**Existing-user path:** The request **must** be authenticated as the user whose email
matches the invite. Returns `{ workspaceId }` — no new tokens issued (use existing session).

**New-user path:** Unauthenticated. Creates a new account with the supplied password.
Returns `{ workspaceId, tokens }`.

**Auth:** none (new user) or Bearer (existing user)  
**Rate limit:** per-IP

**Request body**
```json
{
  "token": "opaque-base64url-from-email",
  "password": "GoodPass!2345A",
  "firstName": "Bob",
  "lastName": "Jones"
}
```

`password`, `firstName`, `lastName` are only required for new users.

**Response 200**
```json
{
  "workspaceId": "uuid",
  "tokens": { "accessToken": "...", "refreshToken": "...", "tokenType": "Bearer", "expiresIn": 900 }
}
```

**Errors:** `TOKEN_INVALID` 401, `INVITE_REQUIRES_LOGIN` 401, `INVITE_EMAIL_MISMATCH` 403

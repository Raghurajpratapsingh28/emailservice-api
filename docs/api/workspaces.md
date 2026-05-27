# Workspaces API

All routes under `/api/v1/workspaces`.

Two route groups:

- **User-scoped** — only requires `Authorization: Bearer <accessToken>`.
- **Workspace-scoped** — additionally requires the `x-workspace-id` header (or path param) and the user must be a member of that workspace.

---

## 1. POST / — Create workspace

 
**Auth:** Bearer

**Request body**
```json
{
  "name": "Acme Inc",
  "slug": "acme",            // optional; auto-generated from name if omitted
  "plan": "free",            // optional; one of: free, starter, pro, enterprise
  "metadata": { "industry": "saas" }   // optional
}
```

**Response 201**
```json
{
  "workspace": {
    "id": "uuid",
    "name": "Acme Inc",
    "slug": "acme",
    "plan": "free",
    "status": "active",
    "ownerUserId": "uuid",
    "metadata": {},
    "version": 1,
    "createdAt": "...",
    "updatedAt": "...",
    "deletedAt": null
  },
  "role": "owner"
}
```

**Errors:** `SLUG_TAKEN` 409

---

## 2. GET / — List user's workspaces

Returns all workspaces the caller is a member of, with role and effective permissions.

**Auth:** Bearer

**Response 200**
```json
{
  "items": [
    {
      "workspace": { "id": "...", "name": "...", "slug": "...", "status": "active", ... },
      "role": "owner",
      "joinedAt": "...",
      "permissions": ["workspace.read", "workspace.write", "..."]
    }
  ]
}
```

---

## 3. GET /current — Get active workspace

Resolves the workspace via `x-workspace-id` header and returns its details.

**Auth:** Bearer + `x-workspace-id`
**Required permission:** `workspace.read`

**Response 200**
```json
{
  "workspace": { ... },
  "role": "admin",
  "permissions": ["workspace.read", "..."]
}
```

**Errors:** `WORKSPACE_ACCESS_DENIED` 403, `WORKSPACE_INACTIVE` 403

---

## 4. PATCH /:workspaceId — Update workspace

Updates name, slug, or metadata. Uses optimistic concurrency — `version` must match the current value.

**Auth:** Bearer + `x-workspace-id`
**Required permission:** `workspace.write`

**Request body**
```json
{
  "name": "Acme Corp",       // optional
  "slug": "acme-corp",       // optional
  "metadata": { ... },       // optional
  "version": 1               // required
}
```

At least one mutable field is required.

**Response 200**
```json
{ "workspace": { ...updated, "version": 2 } }
```

**Errors:** `SLUG_TAKEN` 409, `VERSION_CONFLICT` 409, `WORKSPACE_INACTIVE` 403

---

## 5. POST /switch — Switch active workspace

Issues a fresh access token whose `ws` claim is the new workspace id. Refresh token is **not** rotated.

**Auth:** Bearer

**Request body**
```json
{ "workspaceId": "uuid" }
```

**Response 200**
```json
{
  "workspaceId": "uuid",
  "accessToken": "eyJ...",
  "expiresIn": 900
}
```

**Errors:** `WORKSPACE_ACCESS_DENIED` 403 (not a member), `WORKSPACE_INACTIVE` 403

---

## 6. GET /:workspaceId/settings — Get settings

**Auth:** Bearer + `x-workspace-id`
**Required permission:** `workspace.read`

**Response 200**
```json
{
  "settings": {
    "id": "uuid",
    "workspaceId": "uuid",
    "timezone": "UTC",
    "locale": "en-US",
    "branding": { "logoUrl": "...", "primaryColor": "#000000" },
    "emailDefaults": { "fromName": "...", "fromEmail": "..." },
    "featureFlags": { "feature_x": true },
    "webhookSettings": { "url": "...", "events": [...] },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

If no settings row exists yet, one is lazily created with defaults.

---

## 7. PATCH /:workspaceId/settings — Update settings

**Auth:** Bearer + `x-workspace-id`
**Required permission:** `workspace.write`

**Request body** — all fields optional, at least one required:
```json
{
  "timezone": "America/Los_Angeles",
  "locale": "en-US",
  "branding": {
    "logoUrl": "https://cdn.example.com/logo.png",
    "primaryColor": "#5e3aff"
  },
  "emailDefaults": {
    "fromName": "Acme",
    "fromEmail": "no-reply@acme.com",
    "replyTo": "support@acme.com"
  },
  "featureFlags": { "ai_assist": true },
  "webhookSettings": {
    "url": "https://hooks.example.com/engageiq",
    "secret": "min-16-char-secret",
    "events": ["campaign.sent", "contact.created"]
  }
}
```

**Response 200** — full updated settings row.

---

## 8. GET /:workspaceId/members — List members

**Auth:** Bearer + `x-workspace-id`
**Required permission:** `workspace.members.read`

**Query params**
- `page` (default 1)
- `pageSize` (default 20, max 100)
- `search` — case-insensitive match on email, firstName, lastName
- `role` — filter by role slug (`owner`, `admin`, `member`, `viewer`)

**Response 200**
```json
{
  "items": [
    {
      "membershipId": "uuid",
      "userId": "uuid",
      "email": "alice@example.com",
      "firstName": "Alice",
      "lastName": "Smith",
      "isActive": true,
      "roleSlug": "owner",
      "invitedByUserId": null,
      "joinedAt": "..."
    }
  ],
  "total": 5,
  "page": 1,
  "pageSize": 20
}
```

---

## 9. PATCH /:workspaceId/members/:memberId — Update member role

**Auth:** Bearer + `x-workspace-id`
**Required permission:** `workspace.members.write`

**Request body**
```json
{ "role": "admin" }     // owner role cannot be assigned here — use transfer-ownership
```

**Rules enforced:**
- Cannot change your own role (`CANNOT_CHANGE_OWN_ROLE`).
- Cannot demote owner here (`CANNOT_DEMOTE_OWNER`).
- Cannot manage a member with role weight ≥ yours (`INSUFFICIENT_ROLE`).
- Cannot assign a role at or above your own (`CANNOT_ASSIGN_HIGHER_ROLE`).

**Response 200**
```json
{ "membershipId": "uuid", "role": "admin" }
```

---

## 10. DELETE /:workspaceId/members/:memberId — Remove member

**Auth:** Bearer + `x-workspace-id`
**Required permission:** `workspace.members.write`

**Rules enforced:**
- Cannot remove yourself (`CANNOT_REMOVE_SELF`).
- Cannot remove a member with equal or higher role (`INSUFFICIENT_ROLE`).
- Cannot remove the sole owner (`SOLE_OWNER_PROTECTED`).

The removed user's refresh tokens are revoked best-effort.

**Response 204**

---

## 11. POST /:workspaceId/transfer-ownership — Transfer ownership

**Auth:** Bearer + `x-workspace-id`
**Required role:** `owner`

**Request body**
```json
{ "newOwnerUserId": "uuid" }
```

**Behavior**
- New owner must already be a workspace member (`TARGET_NOT_MEMBER`).
- Cannot transfer to yourself (`VALIDATION_ERROR`).
- Atomic: target promoted to owner, current owner demoted to admin, `workspaces.ownerUserId` updated, `version` bumped.

**Response 200**
```json
{ "newOwnerUserId": "uuid" }
```

---

## 12. POST /:workspaceId/deactivate — Deactivate workspace

Soft-deactivates the workspace. All mutating operations are blocked until reactivation.

**Auth:** Bearer + `x-workspace-id`
**Required role:** `owner`

**Response 200**
```json
{ "workspace": { ..., "status": "inactive" } }
```

**Errors:** `WORKSPACE_DELETED` 409, `VERSION_CONFLICT` 409

---

## 13. POST /:workspaceId/reactivate — Reactivate workspace

Restores an inactive workspace. Cannot be used on hard-deleted workspaces.

**Auth:** Bearer + `x-workspace-id`
**Required role:** `owner` or `admin`

**Response 200**
```json
{ "workspace": { ..., "status": "active" } }
```

**Errors:** `WORKSPACE_DELETED` 409 (cannot reactivate)

---

## Workspace status lifecycle

```
            create
              │
              ▼
          ┌───────┐    deactivate     ┌────────┐
          │active │ ─────────────────►│inactive│
          └───────┘ ◄──────────────── └────────┘
              │       reactivate          │
              │                            │
              └────────────────────────────┴── soft-delete (admin/internal) ──► deleted
```

Only `active` workspaces accept mutating operations. `inactive` allows read + reactivate. `deleted` blocks everything.

# Contacts API

Manage contacts (people) within a workspace. All endpoints require `Authorization: Bearer <token>` and `x-workspace-id: <uuid>`.

## Permissions

| Action | Permission |
|--------|-----------|
| Read contacts | `contacts.read` |
| Create / update / delete | `contacts.write` |

## Endpoints

### POST /api/v1/contacts

Create a contact. At least one of `email`, `anonymousId`, or `externalId` is required. Email is normalized to lowercase. Duplicate emails within a workspace are rejected.

**Request**
```json
{
  "email": "alice@example.com",
  "firstName": "Alice",
  "lastName": "Smith",
  "phone": "+919876543210",
  "lifecycleStage": "lead",
  "leadScore": 10,
  "tags": ["trial", "saas"],
  "properties": { "plan": "free", "country": "India" },
  "source": { "channel": "organic" }
}
```

**Response** `201`
```json
{ "contact": { "id": "uuid", "email": "alice@example.com", "tags": ["trial", "saas"], ... } }
```

**Errors** — `409 CONTACT_ALREADY_EXISTS`

---

### GET /api/v1/contacts

List contacts with pagination and filtering.

**Query params**

| Param | Type | Description |
|-------|------|-------------|
| `page` | int | Default 1 |
| `pageSize` | int | Default 50, max 200 |
| `search` | string | Fuzzy match on email, firstName, lastName |
| `tags` | string | Comma-separated tag filter (AND logic) |
| `lifecycleStage` | string | `lead`, `prospect`, `customer`, `churned`, `unqualified` |
| `emailSuppressed` | boolean | Filter by suppression flag |
| `unsubscribed` | boolean | Filter by unsubscribe flag |
| `fromDate` | ISO date | Created after |
| `toDate` | ISO date | Created before |

**Response** `200`
```json
{ "items": [...], "page": 1, "pageSize": 50, "total": 142 }
```

---

### GET /api/v1/contacts/:id

Return full contact profile including tags.

**Response** `200`
```json
{ "contact": { "id": "uuid", "email": "...", "tags": [...], "properties": {}, ... } }
```

**Errors** — `404 CONTACT_NOT_FOUND`

---

### PATCH /api/v1/contacts/:id

Partial update. All fields optional.

**Request**
```json
{
  "firstName": "Alice",
  "lifecycleStage": "customer",
  "leadScore": 75,
  "tags": ["paying"],
  "properties": { "plan": "pro" },
  "emailSuppressed": false,
  "unsubscribed": false
}
```

Providing `tags` replaces the full tag set.

**Errors** — `404 CONTACT_NOT_FOUND`, `409 CONTACT_ALREADY_EXISTS` (email conflict)

---

### DELETE /api/v1/contacts/:id

Soft-delete. Sets `deleted_at`; event history is preserved.

**Response** `204`

---

### POST /api/v1/contacts/bulk-import

Import up to 1 000 contacts in one request. Duplicates (same workspace + email) are silently skipped.

**Request**
```json
{
  "contacts": [
    { "email": "a@example.com", "tags": ["imported"] },
    { "email": "b@example.com" }
  ]
}
```

**Response** `200`
```json
{ "imported": 2, "skipped": 0 }
```

---

### POST /api/v1/contacts/:id/suppress

Set `emailSuppressed = true`. Suppressed contacts are excluded from campaign sends.

**Response** `200` — updated contact

---

### POST /api/v1/contacts/:id/unsuppress

Set `emailSuppressed = false`.

**Response** `200` — updated contact

## Contact object

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | |
| `workspaceId` | uuid | |
| `email` | string | Lowercase |
| `anonymousId` | string | |
| `externalId` | string | |
| `firstName` | string | |
| `lastName` | string | |
| `phone` | string | |
| `lifecycleStage` | string | `lead` \| `prospect` \| `customer` \| `churned` \| `unqualified` |
| `leadScore` | int | 0–100 |
| `properties` | object | Arbitrary JSONB |
| `source` | object | Attribution metadata |
| `emailSuppressed` | boolean | |
| `globallySuppressed` | boolean | |
| `unsubscribed` | boolean | |
| `tags` | string[] | Attached tag names |
| `deletedAt` | ISO date | Null if active |
| `createdAt` | ISO date | |
| `updatedAt` | ISO date | |

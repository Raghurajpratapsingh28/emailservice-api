# Segments API

Create and manage contact segments. Segments can be **static** (manually managed membership) or **dynamic** (rule-based, computed asynchronously by the Go worker).

All endpoints require `Authorization: Bearer <token>` and `x-workspace-id: <uuid>`.

## Permissions

| Action | Permission |
|--------|-----------|
| Read segments | `segments.read` |
| Create / update / delete / refresh | `segments.write` |

## Endpoints

### POST /api/v1/segments

Create a segment. Dynamic segments require a `filterTree`.

**Request**
```json
{
  "name": "Trial Users",
  "type": "dynamic",
  "filterTree": {
    "operator": "AND",
    "rules": [
      { "field": "properties.plan", "operator": "equals", "value": "free" },
      { "field": "lifecycleStage", "operator": "equals", "value": "lead" }
    ]
  }
}
```

On creation, a `segment.refresh` job is enqueued automatically.

**Response** `201`
```json
{ "segment": { "id": "uuid", "name": "Trial Users", "type": "dynamic", "status": "pending", ... } }
```

---

### GET /api/v1/segments

List segments with pagination.

**Query params** — `page` (default 1), `pageSize` (default 20, max 100)

**Response** `200`
```json
{ "items": [...], "page": 1, "pageSize": 20, "total": 5 }
```

---

### GET /api/v1/segments/:id

Return full segment definition and stats.

**Response** `200`
```json
{ "segment": { "id": "uuid", "filterTree": {...}, "contactCount": 342, "status": "ready", ... } }
```

**Errors** — `404 SEGMENT_NOT_FOUND`

---

### PATCH /api/v1/segments/:id

Update name, type, or filterTree. Triggers automatic recomputation.

**Request**
```json
{ "name": "Free Trial Users", "filterTree": { "operator": "AND", "rules": [...] } }
```

**Errors** — `404 SEGMENT_NOT_FOUND`

---

### DELETE /api/v1/segments/:id

Soft-delete. Sets `deleted_at`.

**Response** `204`

---

### POST /api/v1/segments/:id/refresh

Manually trigger recomputation. Enqueues a `segment.refresh` NATS job.

**Response** `202`
```json
{ "queued": true }
```

---

### GET /api/v1/segments/:id/preview

Return a sample of contacts currently in the segment.

**Query params** — `limit` (default 20, max 100)

**Response** `200`
```json
{ "contacts": [...], "total": 342 }
```

## Filter tree DSL

A `filterTree` is a recursive structure:

```json
{
  "operator": "AND" | "OR",
  "rules": [
    { "field": "...", "operator": "...", "value": "..." },
    { "operator": "OR", "rules": [...] }
  ]
}
```

### Supported field operators

| Operator | Description |
|----------|-------------|
| `equals` | Exact match |
| `not_equals` | Not equal |
| `contains` | String contains |
| `starts_with` | String starts with |
| `ends_with` | String ends with |
| `greater_than` | Numeric / date comparison |
| `less_than` | Numeric / date comparison |
| `exists` | Field is present and non-null |
| `not_exists` | Field is absent or null |
| `in` | Value in array |
| `not_in` | Value not in array |
| `occurred_within_days` | Event occurred within N days (stored, MVP partial support) |

### Field paths

- Contact fields: `email`, `lifecycleStage`, `leadScore`, `phone`
- Custom properties: `properties.<key>` (e.g. `properties.plan`)
- Events: `event:<Event Name>` (e.g. `event:Trial Started`)

## Segment object

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | |
| `workspaceId` | uuid | |
| `name` | string | |
| `type` | string | `static` \| `dynamic` |
| `filterTree` | object | DSL tree (empty for static) |
| `contactCount` | int | Last computed count |
| `status` | string | `pending` \| `computing` \| `ready` \| `failed` |
| `lastComputed` | ISO date | When count was last updated |
| `createdBy` | uuid | |
| `deletedAt` | ISO date | Null if active |
| `createdAt` | ISO date | |
| `updatedAt` | ISO date | |

## NATS contract

On create, update, or manual refresh, the API publishes:

**Subject:** `segment.refresh`

**Payload (locked):**
```json
{ "workspaceId": "uuid", "segmentId": "uuid" }
```

The Go worker subscribes to this subject, evaluates the filter tree against the contacts table, and updates `segment_memberships` + `contact_count`.

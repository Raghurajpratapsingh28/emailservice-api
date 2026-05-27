# Campaigns API

All routes under `/api/v1/campaigns`. Require `Authorization: Bearer` + `x-workspace-id`.

## Status lifecycle

```
draft ──schedule──► scheduled ──trigger──► sending ──► sent | failed
  │                    │                     │
  │                    └──pause──► paused ◄──┘
  │                                  │
  │                                  └──resume──► scheduled | sending | draft
  └──────────────────────────────────────────────────────────────────► cancelled (delete)
```

---

## POST / — Create campaign

**Required permission:** `campaigns.write`

**Request body**
```json
{
  "name": "Welcome Campaign",
  "type": "regular",
  "subject": "Welcome to Acme",
  "previewText": "Let's get started",
  "from": { "email": "hello@acme.com", "name": "Acme" },
  "replyTo": "support@acme.com",
  "html": "<h1>Hello</h1>",
  "text": "Hello",
  "templateId": null,
  "segmentId": "uuid"
}
```

Initial status: `draft`. Sender domain is validated if `from` is provided. Segment must belong to the same workspace.

**Response 201** `{ "campaign": {...} }`

**Errors:** `CAMPAIGN_NAME_TAKEN` 409, `SENDER_DOMAIN_NOT_VERIFIED` 403, `INVALID_SEGMENT` 403

---

## GET / — List campaigns

**Required permission:** `campaigns.read`

**Query params:** `page`, `pageSize` (max 100), `status`, `type`, `search`, `fromDate`, `toDate`

**Response 200** `{ "items": [...], "total": N, "page": 1, "pageSize": 20 }`

---

## GET /:id — Get campaign

**Required permission:** `campaigns.read`

**Response 200** `{ "campaign": {...} }`

**Errors:** `CAMPAIGN_NOT_FOUND` 404

---

## PATCH /:id — Update campaign

**Required permission:** `campaigns.write`

Content edits (subject, html, text, from, template, segment) only allowed on `draft`. Name edits allowed on `draft` and `scheduled`. Requires `version` for optimistic concurrency.

**Request body** — all optional, at least one required + `version`:
```json
{
  "name": "New Name",
  "subject": "New Subject",
  "previewText": "...",
  "from": { "email": "h@acme.com" },
  "replyTo": null,
  "html": "<p>new</p>",
  "text": "new",
  "templateId": null,
  "segmentId": "uuid",
  "version": 1
}
```

**Errors:** `VERSION_CONFLICT` 409, `INVALID_CAMPAIGN_STATE` 403, `CAMPAIGN_NOT_FOUND` 404

---

## POST /:id/schedule — Schedule campaign

**Required permission:** `campaigns.send`

**Request body**
```json
{ "scheduledAt": "2026-06-20T14:00:00Z" }
```

`scheduledAt` must be in the future and within 1 year. Campaign must be in `draft` status.

**Response 200** `{ "campaign": { ..., "status": "scheduled" } }`

**Errors:** `INVALID_SCHEDULE_TIME` 400, `INVALID_CAMPAIGN_STATE` 403

---

## POST /:id/send — Send now

**Required permission:** `campaigns.send`

Validates sender domain, segment audience (must be > 0), and campaign body. Atomically transitions to `sending` and publishes the locked queue contract.

**Response 202**
```json
{ "campaignId": "uuid", "status": "sending", "recipientCount": 1500 }
```

**Errors:** `SENDER_DOMAIN_NOT_VERIFIED` 403, `EMPTY_SEGMENT` 400, `INVALID_SEGMENT` 403, `INVALID_CAMPAIGN_STATE` 403

**Queue contract** (NATS subject `campaign.send.start`):
```json
{
  "jobId": "uuid",
  "workspaceId": "uuid",
  "campaignId": "uuid",
  "segmentId": "uuid",
  "sender": { "email": "hello@acme.com", "name": "Acme" },
  "replyTo": "support@acme.com",
  "subject": "Welcome",
  "html": "<h1>Hello</h1>",
  "text": "Hello"
}
```

---

## POST /:id/pause — Pause campaign

**Required permission:** `campaigns.send`

Allowed from `scheduled` or `sending`. Transitions to `paused`.

**Response 200** `{ "campaign": { ..., "status": "paused" } }`

**Errors:** `INVALID_CAMPAIGN_STATE` 403

---

## POST /:id/resume — Resume campaign

**Required permission:** `campaigns.send`

Resumes a `paused` campaign. Target status is determined automatically:
- `sending` if the campaign had already started
- `scheduled` if a future `scheduledAt` exists
- `draft` otherwise

If resuming to `sending`, re-publishes the queue trigger.

**Response 200** `{ "campaign": { ..., "status": "sending|scheduled|draft" } }`

---

## DELETE /:id — Delete campaign

**Required permission:** `campaigns.write`

Soft-deletes (status → `cancelled`, `deletedAt` set). Cannot delete a `sending` campaign — pause it first.

**Response 204**

**Errors:** `INVALID_CAMPAIGN_STATE` 403 (if sending)

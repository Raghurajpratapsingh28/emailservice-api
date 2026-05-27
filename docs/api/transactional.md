# Transactional Email API

Two route groups:
- **Sends** — `/api/v1/emails`
- **Templates** — `/api/v1/email-templates`

All endpoints require `Authorization: Bearer <token>` and `x-workspace-id`.

---

## POST /api/v1/emails/send

Queues a transactional email. Idempotent via `idempotencyKey` (24h TTL, Redis).

**Required permission:** `emails.send`

**Request body**
```json
{
  "to": [{ "email": "alice@example.com", "name": "Alice" }],
  "from": { "email": "hello@acme.com", "name": "Acme" },
  "replyTo": "support@acme.com",
  "subject": "Welcome",
  "html": "<h1>Hello</h1>",
  "text": "Hello",
  "templateId": null,
  "templateData": { "first_name": "Alice" },
  "tags": { "source": "signup" },
  "idempotencyKey": "signup-user-123"
}
```

Rules:
- `subject` + (`html` or `text`) required unless `templateId` is set
- Max 50 recipients
- Sender domain must be verified in the workspace (`domains.status = 'verified'`)
- Sender host cannot be localhost or IPv4 literal
- Monthly quota enforced per workspace plan

**Response 202**
```json
{ "sendId": "uuid", "status": "queued" }
```

**Errors:** `SENDER_DOMAIN_NOT_VERIFIED` 403, `EMAIL_QUOTA_EXCEEDED` 403, `IDEMPOTENT_REPLAY` 409, `TEMPLATE_NOT_FOUND` 404

**Queue contract** (NATS subject `email.send.transactional`):
```json
{
  "jobId": "uuid", "workspaceId": "uuid", "sendId": "uuid",
  "to": [...], "from": {...}, "replyTo": "...",
  "subject": "...", "html": "...", "text": "...",
  "tags": {...}, "provider": "ses"
}
```

---

## GET /api/v1/emails

**Required permission:** `emails.read`

**Query params:** `page`, `pageSize` (max 100), `status`, `recipient`, `fromDate`, `toDate`

**Response 200**
```json
{ "items": [...], "total": 5, "page": 1, "pageSize": 20 }
```

---

## GET /api/v1/emails/:sendId

**Required permission:** `emails.read`

**Response 200**
```json
{
  "sendId": "uuid", "status": "queued|sending|sent|failed|bounced",
  "providerMessageId": "...", "failureReason": null,
  "subject": "...", "senderEmail": "...", "recipientEmail": "...",
  "tags": {}, "createdAt": "...", "updatedAt": "..."
}
```

**Errors:** `EMAIL_NOT_FOUND` 404

---

## POST /api/v1/email-templates

Creates a draft template. Set `publish: true` to publish immediately.

**Required permission:** `templates.write`

**Request body**
```json
{
  "name": "Welcome",
  "subject": "Welcome {{first_name}}",
  "htmlBody": "<h1>Hello {{first_name}}</h1>",
  "textBody": "Hello {{first_name}}",
  "variables": { "first_name": "string" },
  "publish": true
}
```

**Response 201** `{ "template": {...} }`

---

## GET /api/v1/email-templates

**Required permission:** `templates.read`

**Query params:** `page`, `pageSize`, `status` (draft|published|archived), `search`, `latestOnly` (bool)

---

## GET /api/v1/email-templates/:id

**Required permission:** `templates.read`

---

## PATCH /api/v1/email-templates/:id

Updates a draft. If the template is already published, automatically clones it as the next draft version (immutable history). Set `publish: true` to publish the result.

**Required permission:** `templates.write`

**Request body** — all optional, at least one required:
```json
{ "subject": "...", "htmlBody": "...", "textBody": "...", "variables": {}, "publish": true }
```

---

## DELETE /api/v1/email-templates/:id

Soft-deletes (status → archived). **Required permission:** `templates.write`

**Response 204**

---

## Template variable interpolation

Templates use `{{variable_name}}` syntax. Variables are substituted from `templateData` at send time. Missing variables are replaced with empty string.

```json
{
  "templateId": "uuid",
  "templateData": { "first_name": "Alice", "company": "Acme" }
}
```

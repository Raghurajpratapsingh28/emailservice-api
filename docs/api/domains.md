# Domains API

All routes under `/api/v1/domains`.

Every endpoint requires:
- `Authorization: Bearer <accessToken>`
- `x-workspace-id: <uuid>` header
- Workspace membership validated by `workspaceGuard`

---

## POST / — Onboard a sending domain

Creates an AWS SES domain identity, provisions Easy DKIM, and returns the DNS records you must publish.

**Required permission:** `domains.write`

**Request body**
```json
{ "domain": "acme.com" }
```

Domain rules: lowercase ASCII, at least one dot, no localhost/IP/reserved TLDs (`.test`, `.example`, `.invalid`, `.localhost`, `.local`). Leading `www.` is stripped automatically.

**Response 201**
```json
{
  "id": "uuid",
  "workspaceId": "uuid",
  "domain": "acme.com",
  "sesIdentity": "acme.com",
  "status": "verifying",
  "dkimTokens": ["t1", "t2", "t3"],
  "verificationStartedAt": "...",
  "verificationAttempts": 0,
  "version": 2,
  "createdAt": "...",
  "updatedAt": "...",
  "dns": {
    "spf": {
      "type": "TXT",
      "host": "@",
      "value": "v=spf1 include:amazonses.com ~all"
    },
    "dkim": [
      { "type": "CNAME", "host": "t1._domainkey.acme.com", "value": "t1.dkim.amazonses.com" },
      { "type": "CNAME", "host": "t2._domainkey.acme.com", "value": "t2.dkim.amazonses.com" },
      { "type": "CNAME", "host": "t3._domainkey.acme.com", "value": "t3.dkim.amazonses.com" }
    ],
    "dmarc": {
      "type": "TXT",
      "host": "_dmarc.acme.com",
      "value": "v=DMARC1; p=none; rua=mailto:dmarc-reports@acme.com; ..."
    }
  }
}
```

**Errors:** `DOMAIN_ALREADY_EXISTS` 409, `INVALID_DOMAIN` 400, `INTERNAL_ERROR` 500 (SES failure — DB row is rolled back)

**Side effects:**
- Publishes `domain.created.v1` and `domain.verify.poll.v1` to NATS
- A worker subscribes to `domain.verify.poll.v1` and polls SES until verified

---

## GET / — List domains

**Required permission:** `domains.read`

**Query params**
- `page` (default 1)
- `pageSize` (default 20, max 100)
- `status` — filter by status (`pending`, `verifying`, `verified`, `failed`, `deleting`, `deleted`)

**Response 200**
```json
{
  "items": [
    {
      "id": "uuid",
      "domain": "acme.com",
      "status": "verified",
      "dkimTokens": ["t1", "t2", "t3"],
      "verifiedAt": "...",
      "dns": { "spf": {...}, "dkim": [...], "dmarc": {...} }
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

---

## GET /:id — Get domain

**Required permission:** `domains.read`

Returns full domain details including DNS records. Soft-deleted domains return 404.

**Response 200** — same shape as POST response.

**Errors:** `DOMAIN_NOT_FOUND` 404

---

## POST /:id/verify — Requeue verification

Manually re-enqueues the SES verification poll. Useful when DNS was published late.

**Required permission:** `domains.write`

**Response 202**
```json
{ "status": "verifying" }
```

**Errors:** `DOMAIN_NOT_FOUND` 404, `DOMAIN_ALREADY_VERIFIED` 409, `FORBIDDEN` 403 (domain is being deleted)

---

## DELETE /:id — Delete domain

Soft-deletes the domain and removes the SES identity (idempotent). The row is retained as a tombstone for audit.

**Required permission:** `domains.write`

**Response 204**

**Errors:** `DOMAIN_NOT_FOUND` 404, `CONFLICT` 409 (concurrent state change)

**Side effects:**
- Publishes `domain.deleted.v1` to NATS
- SES `DeleteEmailIdentity` is called best-effort (failure is logged but does not block the response)

---

## Domain status lifecycle

```
create
  │
  ▼
pending ──── SES provisioned ──► verifying ──── SES poll success ──► verified
                                     │
                                     └── SES poll failure ──► failed
                                     │
                                     └── manual requeue ──► verifying (reset)

any status ──── DELETE ──► deleting ──── SES delete ──► deleted (tombstone)
```

---

## DNS records to publish

After calling `POST /domains`, publish these records in your DNS provider:

| Type | Host | Value |
|------|------|-------|
| TXT | `@` | `v=spf1 include:amazonses.com ~all` |
| CNAME | `<token>._domainkey.yourdomain.com` | `<token>.dkim.amazonses.com` (×3) |
| TXT | `_dmarc.yourdomain.com` | `v=DMARC1; p=none; rua=mailto:...` |

DMARC starts in monitoring mode (`p=none`). Tighten to `p=quarantine` or `p=reject` once you confirm no legitimate mail is failing.

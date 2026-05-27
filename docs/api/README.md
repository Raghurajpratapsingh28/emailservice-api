# API Reference

Base URL: `https://api.engageiq.dev` (production) / `http://localhost:4000` (local)

All endpoints are under `/api/v1/`.

## Common conventions

**Authentication** — include `Authorization: Bearer <accessToken>` on protected routes.

**Workspace context** — include `x-workspace-id: <uuid>` on workspace-scoped routes.

**Error envelope** — all errors return:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": [...],
    "requestId": "uuid"
  }
}
```

See [error-codes.md](error-codes.md) for the full code list.

## Modules

| Module | Prefix | Doc |
|--------|--------|-----|
| Auth | `/api/v1/auth` | [auth.md](auth.md) |
| Workspaces | `/api/v1/workspaces` | [workspaces.md](workspaces.md) |
| Domains | `/api/v1/domains` | [domains.md](domains.md) |
| Transactional Emails | `/api/v1/emails` | [transactional.md](transactional.md) |
| Email Templates | `/api/v1/email-templates` | [transactional.md](transactional.md) |
| Campaigns | `/api/v1/campaigns` | [campaigns.md](campaigns.md) |
| Contacts | `/api/v1/contacts` | [contacts.md](contacts.md) |
| Segments | `/api/v1/segments` | [segments.md](segments.md) |
| Workflows | `/api/v1/workflows` | [workflows.md](workflows.md) |
| Billing | `/api/v1/billing` | [billing.md](billing.md) |
| Stripe Webhooks | `/api/v1/webhooks/stripe` | [billing.md](billing.md#webhooks) |

## Health endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | none | Liveness probe — always 200 |
| GET | `/ready` | none | Readiness probe — checks DB + Redis |
| GET | `/metrics` | `x-internal-key` | Prometheus metrics |
| GET | `/docs` | none | Swagger UI (disabled in production unless `SWAGGER_ENABLED=true`) |

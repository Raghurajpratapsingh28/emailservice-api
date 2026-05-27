# EngageIQ API — Documentation

## Contents

| Section | What's inside |
|---------|--------------|
| [architecture/](architecture/) | System design, module map, data flow, NATS event catalog |
| [api/](api/) | HTTP endpoints reference, request/response shapes, error codes |
| [auth/](auth/) | Authentication flows, RBAC model, token lifecycle, session management |
| [database/](database/) | Schema reference, migration guide, seeding |
| [security/](security/) | Security model, threat mitigations, hardening decisions |
| [deployment/](deployment/) | Environment variables, Docker, Kubernetes, production checklist |
| [development/](development/) | Local setup, testing, code conventions |

## Implemented modules

| Module | Prefix | Status |
|--------|--------|--------|
| Auth | `/api/v1/auth` | ✅ |
| Workspaces | `/api/v1/workspaces` | ✅ |
| Domains (SES) | `/api/v1/domains` | ✅ |
| Transactional Emails | `/api/v1/emails` | ✅ |
| Email Templates | `/api/v1/email-templates` | ✅ |
| Campaigns | `/api/v1/campaigns` | ✅ |
| Contacts | `/api/v1/contacts` | ✅ |
| Segments | `/api/v1/segments` | ✅ |
| Workflows | `/api/v1/workflows` | ✅ |
| Billing (Stripe) | `/api/v1/billing` | ✅ |
| Stripe Webhooks | `/api/v1/webhooks/stripe` | ✅ |
| Events | `/api/v1/events` | ✅ |
| AI | `/api/v1/ai` | 🔜 |

## Quick start

```bash
cp .env.example .env          # fill in secrets
docker compose -f infra/docker/docker-compose.yml down -v
docker compose -f infra/docker/docker-compose.yml up --build
```

Swagger UI: `http://localhost:4000/docs`

Metrics: `http://localhost:4000/metrics?key=<INTERNAL_API_KEY>`

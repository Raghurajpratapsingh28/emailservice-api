# Architecture Overview

## Stack

| Layer | Technology |
|-------|-----------|
| HTTP server | Fastify 5 |
| Language | TypeScript (strict, ESM) |
| Database | PostgreSQL 16 via Drizzle ORM |
| Cache / session store | Redis 7 (ioredis) |
| Message bus | NATS 2 (JetStream optional) |
| Job queue | BullMQ (Redis-backed) |
| Auth | JWT (HS256) + opaque refresh tokens |
| Observability | prom-client, Winston, OpenTelemetry |

## Repository layout

```
engageiq-api/
├── src/
│   ├── app/            # Fastify bootstrap, route registration, Swagger
│   ├── config/         # Zod-validated env config (single source of truth)
│   ├── constants/      # RBAC matrix, NATS subjects, plan limits
│   ├── http/           # Cross-cutting HTTP concerns
│   │   ├── decorators/ # app.authenticate, app.workspaceGuard, etc.
│   │   ├── hooks/      # Error handler, request logger
│   │   └── middleware/ # authenticate, rbac, rate-limit, workspace-plan
│   ├── modules/        # Feature modules (auth, workspaces, contacts, …)
│   │   └── <module>/
│   │       ├── controllers/
│   │       ├── services/
│   │       ├── schemas/    # Zod request/response schemas
│   │       ├── middleware/ # Module-scoped middleware
│   │       └── routes.ts
│   ├── plugins/        # Fastify plugins (database, redis, nats, auth)
│   ├── shared/         # Shared utilities, DB client, error types
│   │   ├── cache/      # Redis client, JTI denylist
│   │   ├── database/   # Drizzle client + schema
│   │   ├── email/      # Email publisher (NATS-backed)
│   │   ├── errors/     # AppError hierarchy
│   │   ├── payments/   # Stripe SDK wrapper (createStripeClient, createStripeStub)
│   │   ├── queue/      # NATS client
│   │   ├── types/      # Shared TypeScript interfaces
│   │   ├── utils/      # crypto, jwt, password, time, tokens, id
│   │   └── validators/ # Shared Zod primitives
│   ├── jobs/           # BullMQ processors and schedulers
│   └── observability/  # Logger, metrics, tracer
├── database/
│   ├── migrations/     # Drizzle-generated SQL
│   └── seeds/          # Role/permission seeder
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── infra/
│   ├── docker/
│   └── k8s/
└── docs/               # ← you are here
```

## Request lifecycle

```
Client
  │
  ▼
Fastify (CORS → Helmet → body parse)
  │
  ▼
Rate limiter (Redis fixed-window, per-IP + per-email)
  │
  ▼
authenticate (JWT verify → jti denylist → iat vs passwordChangedAt → DB hydrate)
  │
  ▼
workspaceGuard (x-workspace-id header → DB lookup → RBAC cache)
  │
  ▼
requirePermissions / requireRole
  │
  ▼
Controller (Zod parse → Service call)
  │
  ▼
Service (business logic, DB transaction, NATS publish, audit log)
  │
  ▼
Response
```

## Multi-tenancy model

Every protected resource is scoped to a **workspace**. A user may belong to
multiple workspaces with different roles in each. The active workspace is
identified by the `x-workspace-id` request header.

```
User ──< WorkspaceMember >── Workspace
              │
              └── Role ──< RolePermission >── Permission
```

See [auth/rbac.md](../auth/rbac.md) for the full permission matrix.

## Module catalog

| Module | Responsibility |
|--------|---------------|
| `auth` | Signup, login, refresh, logout, password reset, email verification, invites, sessions |
| `workspaces` | Workspace CRUD, settings, member management, role transitions, ownership transfer, deactivate/reactivate |
| `domains` | AWS SES sending-domain onboarding, DKIM/SPF/DMARC record generation, verification polling |
| `transactional` | Transactional email sends (idempotent, quota-gated) + versioned email templates |
| `campaigns` | Campaign lifecycle (draft → scheduled → sending → sent), segment-based bulk sends, pause/resume |
| `contacts` | Contact CRUD, bulk import, tag management, suppression, quota-metered |
| `segments` | Static and dynamic contact segments with filter DSL; async refresh via Go worker |
| `workflows` | MVP automation workflows (trigger → email → delay → end); Go worker executes |
| `billing` | Stripe subscription lifecycle, checkout, customer portal, usage metering, invoice sync, webhook reconciliation |
| `events` | Tracking event ingestion (track, identify, page, group, alias) |
| `admin` | Internal super-admin operations |

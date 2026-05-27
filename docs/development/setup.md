# Local Development Setup

## Prerequisites

- Node.js ≥ 20
- Docker + Docker Compose
- `npm`

## First-time setup

```bash
# 1. Clone and install
git clone <repo>
cd engageiq-api
npm install

# 2. Environment
cp .env.example .env
# Edit .env — at minimum set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, INTERNAL_API_KEY

# 3. Start infrastructure
docker compose -f infra/docker/docker-compose.yml up -d

# 4. Database
npm run db:migrate
npm run db:seed

# 5. Start dev server (hot reload)
npm run dev
```

Server: `http://localhost:4000`  
Swagger: `http://localhost:4000/docs`

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot reload (tsx watch) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled output |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run lint` | ESLint |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm test` | Unit + integration tests |
| `npm run test:watch` | Watch mode |
| `npm run test:e2e` | E2E tests (requires running infra) |
| `npm run test:coverage` | Coverage report |
| `npm run db:generate` | Generate SQL migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed roles and permissions |
| `npm run db:studio` | Open Drizzle Studio |

## Testing

Unit tests run without any infrastructure:
```bash
npm test -- test/unit
```

Integration tests require Postgres + Redis + NATS. They auto-skip if infra is unreachable:
```bash
docker compose -f infra/docker/docker-compose.yml up -d
npm test -- test/integration
```

Test database is `engageiq_test` (Redis DB 15). Each test suite truncates all tables
in `beforeEach` and re-seeds RBAC.

## Code conventions

- **ESM modules** — all imports use `.js` extension (even for `.ts` source files).
- **Path aliases** — use `@config/`, `@shared/`, `@modules/`, etc. (defined in `tsconfig.json`).
- **Zod for validation** — all request bodies are parsed with Zod schemas in the controller layer.
- **AppError hierarchy** — throw typed errors from `@shared/errors/app-errors.ts`; never throw plain `Error` from service code.
- **No `any`** — TypeScript strict mode; `any` triggers a lint warning.
- **Transactions** — use `db.transaction()` for any multi-statement write. Use `.for('update')` when reading a row you intend to mutate.
- **Audit everything** — call `audit.record()` for every security-sensitive action.

## Adding a new module

1. Create `src/modules/<name>/` with `controllers/`, `services/`, `schemas/`, `repositories/`, `routes.ts`.
2. Register the routes in `src/app/routes.ts`.
3. Add Drizzle schema to `src/shared/database/schema/` and re-export from `schema/index.ts`.
4. Add any new permissions to `src/constants/rbac.ts` and update `ROLE_PERMISSIONS`.
5. Add any new NATS subjects to `src/constants/nats-subjects.ts`.
6. Instantiate the service in `src/plugins/auth.plugin.ts` and add it to `app.services`.
7. Run `npm run db:generate` to create the migration.
8. Run `npm run db:seed` to re-seed roles/permissions if you added new permissions.
9. Add unit tests in `test/unit/` and integration tests in `test/integration/`.

## Locked queue contracts

Two NATS subjects have a locked payload shape — **do not change them** without coordinating with the worker tier:

| Subject | Used by |
|---------|---------|
| `email.send.transactional` | Transactional email worker |
| `campaign.send.start` | Campaign send worker |

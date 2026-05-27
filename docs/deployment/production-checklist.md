# Production Checklist

## Before first deploy

- [ ] All required env vars set (see [environment.md](environment.md))
- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are different, ≥64 random bytes each
- [ ] `INTERNAL_API_KEY` is ≥32 random hex chars
- [ ] `BCRYPT_ROUNDS` ≥ 12
- [ ] `TRUST_PROXY` set to your load-balancer CIDR (not `true`)
- [ ] `SWAGGER_ENABLED=false` (or path is not publicly routable)
- [ ] `CORS_ORIGINS` set to your frontend domain(s) only
- [ ] `DATABASE_SSL=true` if DB is not on the same private network
- [ ] `NODE_ENV=production`
- [ ] `LOG_LEVEL=info` (not `debug`)

## Database

- [ ] `npm run db:migrate` applied against production DB
- [ ] `npm run db:seed` run (roles + permissions)
- [ ] DB user has only `SELECT`, `INSERT`, `UPDATE`, `DELETE` on app tables (no DDL)
- [ ] Connection pool max tuned to DB max_connections

## Redis

- [ ] Redis is not publicly accessible
- [ ] Redis has a password (`requirepass`)
- [ ] Redis `maxmemory-policy` set to `allkeys-lru` or `volatile-lru`

## Kubernetes / Docker

- [ ] Secrets injected via Kubernetes Secrets or a secrets manager (not env files in image)
- [ ] Liveness probe: `GET /health`
- [ ] Readiness probe: `GET /ready`
- [ ] Resource limits set on the container
- [ ] HPA configured (CPU + memory)

## Monitoring

- [ ] `/metrics` endpoint scraped by Prometheus (via internal network only)
- [ ] Alerts configured for:
  - `auth_login_attempts_total{outcome="locked"}` spike
  - `auth_refresh_outcomes_total{outcome="reuse"}` any occurrence
  - `auth_token_revocations_total{reason="family_compromised"}` any occurrence
  - High `auth_bcrypt_duration_seconds` (indicates CPU pressure)
  - `domains_ses_failures_total` spike (SES API errors)
  - `campaigns_send_triggers_total{outcome="rollback"}` any occurrence (NATS publish failure)
  - `emails_transactional_queue_publish_failures_total` spike
- [ ] Audit log table shipped to SIEM or log aggregator
- [ ] Structured logs (JSON) shipped to log aggregator

## Secrets rotation

- [ ] Procedure documented for rotating `JWT_ACCESS_SECRET` (requires rolling restart; in-flight tokens will fail until clients refresh)
- [ ] Procedure documented for rotating `JWT_REFRESH_SECRET` (all refresh tokens become invalid; users must re-login)
- [ ] `INTERNAL_API_KEY` rotation procedure documented

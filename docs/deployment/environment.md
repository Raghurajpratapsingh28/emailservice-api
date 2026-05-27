# Environment Variables

All variables are validated at startup via Zod. The app will refuse to start if any
required variable is missing or invalid.

Copy `.env.example` to `.env` and fill in the secrets.

## Application

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | no | `development` | `development`, `test`, `staging`, `production` |
| `LOG_LEVEL` | no | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `APP_NAME` | no | `engageiq-api` | Service name in logs |
| `APP_VERSION` | no | `1.0.0` | Reported in Swagger |

## HTTP server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HOST` | no | `0.0.0.0` | Bind address |
| `PORT` | no | `4000` | Listen port |
| `TRUST_PROXY` | no | `true` | `true` (loopback only), `false`, CIDR list, or hop count |
| `BODY_LIMIT_BYTES` | no | `1048576` | Max request body size (1 MB) |
| `REQUEST_TIMEOUT_MS` | no | `30000` | Request timeout |
| `APP_PUBLIC_URL` | **yes** | — | Frontend URL (used in email links) |
| `API_PUBLIC_URL` | **yes** | — | API URL (used in Swagger) |
| `CORS_ORIGINS` | no | `""` | Comma-separated allowed origins |

## PostgreSQL

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **yes** | — | `postgres://user:pass@host:5432/db` |
| `DATABASE_POOL_MAX` | no | `20` | Max pool connections |
| `DATABASE_SSL` | no | `false` | Require SSL |

## Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | **yes** | — | `redis://host:6379/0` |
| `REDIS_KEY_PREFIX` | no | `engageiq:` | Key namespace |

## NATS

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NATS_URL` | **yes** | — | `nats://host:4222` |
| `NATS_NAME` | no | `engageiq-api` | Client name |

## JWT / Auth

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_ACCESS_SECRET` | **yes** | — | ≥32 chars. `openssl rand -base64 64` |
| `JWT_REFRESH_SECRET` | **yes** | — | ≥32 chars, different from access secret |
| `JWT_ACCESS_TTL` | no | `15m` | Access token lifetime |
| `JWT_REFRESH_TTL` | no | `30d` | Refresh token lifetime |
| `JWT_ISSUER` | no | `engageiq` | JWT `iss` claim |
| `JWT_AUDIENCE` | no | `engageiq-api` | JWT `aud` claim |

## Auth security

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BCRYPT_ROUNDS` | no | `12` | bcrypt cost factor (min 10 in production) |
| `ACCOUNT_LOCKOUT_MAX_ATTEMPTS` | no | `10` | Failed logins before lockout |
| `ACCOUNT_LOCKOUT_WINDOW_S` | no | `900` | Sliding window for lockout counter (seconds) |
| `ACCOUNT_LOCKOUT_DURATION_S` | no | `900` | Lockout duration (seconds) |
| `PASSWORD_RESET_TTL_S` | no | `3600` | Password reset token lifetime |
| `EMAIL_VERIFICATION_TTL_S` | no | `86400` | Email verification token lifetime |
| `INVITE_TTL_S` | no | `604800` | Invite token lifetime (7 days) |
| `RATE_LIMIT_AUTH_MAX` | no | `10` | Base rate limit for auth endpoints |
| `RATE_LIMIT_AUTH_WINDOW` | no | `1m` | Rate limit window |
| `INTERNAL_API_KEY` | **yes** | — | ≥16 chars. Used for `/metrics` and internal routes |

## Email

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMAIL_FROM` | **yes** | — | Sender address |
| `EMAIL_REPLY_TO` | no | — | Reply-to address |
| `AWS_REGION` | no | `us-east-1` | AWS region for SES (transactional + domain identity) |
| `AWS_ACCESS_KEY_ID` | no | — | AWS credentials (falls back to instance profile / env chain) |
| `AWS_SECRET_ACCESS_KEY` | no | — | AWS credentials |

## Swagger

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SWAGGER_ENABLED` | no | `true` | Set `false` in production unless needed |
| `SWAGGER_PATH` | no | `/docs` | Swagger UI path |

## Stripe billing

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STRIPE_SECRET_KEY` | billing only | — | `sk_live_...` or `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | billing only | — | `whsec_...` from Stripe Dashboard → Webhooks |
| `STRIPE_API_VERSION` | no | `2024-12-18.acacia` | Stripe API version to pin |
| `STRIPE_CHECKOUT_SUCCESS_URL` | billing only | — | Redirect URL after successful checkout. Supports `{CHECKOUT_SESSION_ID}` placeholder. |
| `STRIPE_CHECKOUT_CANCEL_URL` | billing only | — | Redirect URL when user cancels checkout |
| `STRIPE_PORTAL_RETURN_URL` | billing only | — | Return URL from Customer Portal |
| `STRIPE_STARTER_MONTHLY_PRICE_ID` | billing only | — | Stripe Price ID for starter/monthly |
| `STRIPE_STARTER_YEARLY_PRICE_ID` | billing only | — | Stripe Price ID for starter/yearly |
| `STRIPE_GROWTH_MONTHLY_PRICE_ID` | billing only | — | Stripe Price ID for growth/monthly |
| `STRIPE_GROWTH_YEARLY_PRICE_ID` | billing only | — | Stripe Price ID for growth/yearly |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | billing only | — | Stripe Price ID for pro/monthly |
| `STRIPE_PRO_YEARLY_PRICE_ID` | billing only | — | Stripe Price ID for pro/yearly |

"billing only" means the app boots without these variables but billing endpoints will return `STRIPE_NOT_CONFIGURED`.

### Stripe webhook setup

Register `https://api.yourdomain.com/api/v1/webhooks/stripe` in the Stripe Dashboard with these events:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.created
invoice.finalized
invoice.payment_succeeded
invoice.payment_failed
invoice.upcoming
```

## Generating secrets

```bash
# JWT secrets
openssl rand -base64 64

# Internal API key
openssl rand -hex 32
```

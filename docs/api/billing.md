# Billing API

Stripe-backed subscription management. All authenticated endpoints require `Authorization: Bearer <token>` and `x-workspace-id: <uuid>`.

## Permissions

| Action | Permission | Roles |
|--------|-----------|-------|
| Read subscription, usage, invoices | `billing.read` | owner, admin, viewer |
| Checkout, portal, change plan, cancel, resume | `billing.write` | owner only |

## Plans

| Plan | Contacts | Emails/mo | Events/mo |
|------|----------|-----------|-----------|
| `free` | 100 | 500 | 1 000 |
| `starter` | 5 000 | 20 000 | 50 000 |
| `growth` | 50 000 | 200 000 | 500 000 |
| `pro` | 500 000 | 2 000 000 | 5 000 000 |

`free` is the default for all new workspaces. Upgrade via `/billing/checkout`.

## Endpoints

### POST /api/v1/billing/checkout

Create a Stripe Checkout session. Redirects the user to Stripe's hosted payment page.

**Request**
```json
{ "plan": "growth", "billingInterval": "monthly" }
```

`plan` must be `starter`, `growth`, or `pro`. `billingInterval` is `monthly` or `yearly`.

**Response** `200`
```json
{ "checkoutUrl": "https://checkout.stripe.com/...", "sessionId": "cs_..." }
```

**Errors** — `400 INVALID_PLAN`, `409 CHECKOUT_ALREADY_IN_PROGRESS`

Idempotency: a Redis NX lock prevents two concurrent checkout sessions for the same workspace. The lock is released on success (via `checkout.session.completed` webhook) or on Stripe error.

---

### POST /api/v1/billing/portal

Create a Stripe Customer Portal session for self-service plan management, payment method updates, and invoice downloads.

**Response** `200`
```json
{ "url": "https://billing.stripe.com/..." }
```

---

### GET /api/v1/billing/subscription

Return the current workspace subscription state.

**Response** `200`
```json
{
  "plan": "growth",
  "status": "active",
  "billingInterval": "monthly",
  "currentPeriodStart": "2026-05-01T00:00:00Z",
  "currentPeriodEnd": "2026-06-01T00:00:00Z",
  "cancelAtPeriodEnd": false,
  "canceledAt": null,
  "trialEndsAt": null,
  "stripeCustomerId": "cus_...",
  "stripeSubscriptionId": "sub_..."
}
```

Returns a synthetic `free` record if no subscription row exists yet.

---

### GET /api/v1/billing/usage

Return metered usage for the current billing period vs plan limits.

**Response** `200`
```json
{
  "contacts": { "used": 1200, "limit": 50000 },
  "emails":   { "used": 8400, "limit": 200000 },
  "events":   { "used": 42000, "limit": 500000 },
  "periodStart": "2026-05-01T00:00:00Z",
  "periodEnd":   "2026-06-01T00:00:00Z"
}
```

Cached in Redis for 30 seconds. Cache is invalidated on any usage increment or subscription change.

---

### GET /api/v1/billing/invoices

List invoice history. Paginated.

**Query params** — `page` (default 1), `pageSize` (default 20, max 100)

**Response** `200`
```json
{
  "items": [
    {
      "id": "in_...",
      "amountDue": 2900,
      "amountPaid": 2900,
      "currency": "usd",
      "status": "paid",
      "hostedInvoiceUrl": "https://invoice.stripe.com/...",
      "pdfUrl": "https://pay.stripe.com/invoice/.../pdf",
      "createdAt": "2026-05-01T00:00:00Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 3
}
```

Amounts are in the smallest currency unit (cents for USD).

---

### POST /api/v1/billing/cancel

Cancel the subscription at the end of the current billing period. The workspace retains access until `currentPeriodEnd`.

**Response** `200`
```json
{
  "plan": "growth",
  "status": "active",
  "cancelAtPeriodEnd": true,
  "canceledAt": "2026-05-26T03:00:00Z",
  "currentPeriodEnd": "2026-06-01T00:00:00Z"
}
```

**Errors** — `403 ACTIVE_SUBSCRIPTION_REQUIRED`

---

### POST /api/v1/billing/resume

Undo a pending cancellation. Only valid when `cancelAtPeriodEnd` is `true`.

**Response** `200`
```json
{ "plan": "growth", "status": "active", "cancelAtPeriodEnd": false }
```

**Errors** — `400 INVALID_WORKFLOW_STATE` (not pending cancellation)

---

### POST /api/v1/billing/change-plan

Upgrade or downgrade the subscription. Proration is applied immediately.

**Request**
```json
{ "plan": "pro", "billingInterval": "yearly" }
```

**Response** `200`
```json
{
  "plan": "pro",
  "billingInterval": "yearly",
  "status": "active",
  "currentPeriodStart": "2026-05-26T00:00:00Z",
  "currentPeriodEnd": "2027-05-26T00:00:00Z"
}
```

**Errors** — `403 ACTIVE_SUBSCRIPTION_REQUIRED`, `400 INVALID_PLAN`

---

## Webhooks

### POST /api/v1/webhooks/stripe

Stripe webhook endpoint. **No JWT auth** — the `Stripe-Signature` header is the authentication mechanism.

**Security requirements:**
- Raw body is preserved for HMAC-SHA256 signature verification
- Events older than 5 minutes trigger a warning (still processed — Stripe retries legitimately)
- Two-tier dedup: Redis NX fast-path + DB UNIQUE constraint on `stripe_event_id`
- Handler failures release the Redis dedup key so Stripe can retry

**Handled events:**

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Reconcile subscription, release checkout lock |
| `customer.subscription.created` | Upsert subscription row |
| `customer.subscription.updated` | Upsert subscription row |
| `customer.subscription.deleted` | Mark canceled, demote workspace to `free` plan |
| `invoice.created` | Sync invoice record |
| `invoice.finalized` | Sync invoice record |
| `invoice.payment_succeeded` | Sync invoice record |
| `invoice.payment_failed` | Sync invoice record, emit payment failure metric |
| `invoice.upcoming` | Sync invoice record |

**Response** `200`
```json
{ "received": true }
```

Always returns 200 after safe persistence. Stripe will retry on 4xx/5xx.

## Subscription statuses

| Status | Description |
|--------|-------------|
| `trialing` | In free trial period |
| `active` | Paid and current |
| `past_due` | Payment failed; grace period active |
| `unpaid` | Grace period expired; access may be restricted |
| `canceled` | Subscription ended |
| `incomplete` | Initial payment pending |
| `incomplete_expired` | Initial payment window expired |

## Redis keys

| Key | TTL | Purpose |
|-----|-----|---------|
| `billing:checkout:{workspaceId}` | 60s | In-flight checkout lock (NX) |
| `billing:webhook:{stripeEventId}` | 7 days | Webhook dedup fast-path |
| `billing:usage:{workspaceId}` | 30s | Usage snapshot cache |

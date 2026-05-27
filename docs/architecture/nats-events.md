# NATS Event Catalog

All inter-service events are published as JSON over NATS. Subjects follow the
convention `<bounded-context>.<event>.<version>`.

## Auth events

| Subject | Published when | Payload fields |
|---------|---------------|----------------|
| `auth.user.registered.v1` | Successful signup | `userId`, `email`, `workspaceId`, `occurredAt` |
| `auth.user.logged_in.v1` | Successful login | `userId`, `occurredAt` |
| `auth.user.logged_out.v1` | Logout (single or all) | `userId`, `occurredAt` |
| `auth.password.reset_requested.v1` | Forgot-password token issued | `userId`, `occurredAt` |
| `auth.password.reset_completed.v1` | Password successfully reset | `userId`, `occurredAt` |
| `auth.email.verification_requested.v1` | Verification email sent | `userId`, `email`, `occurredAt` |
| `auth.email.verified.v1` | Email address confirmed | `userId`, `occurredAt` |
| `auth.invite.sent.v1` | Workspace invite issued | `inviteId`, `workspaceId`, `email`, `role`, `occurredAt` |
| `auth.invite.accepted.v1` | Invite accepted | `workspaceId`, `userId`, `occurredAt` |

## Email pipeline

| Subject | Published when | Payload fields |
|---------|---------------|----------------|
| `email.transactional.send.v1` | Any transactional email queued | `to`, `subject`, `template`, `data`, `from`, `replyTo`, `idempotencyKey`, `publishedAt` |

## Workspace events

| Subject | Published when | Payload fields |
|---------|---------------|----------------|
| `workspace.created.v1` | New workspace created | `workspaceId`, `ownerUserId`, `slug`, `occurredAt` |
| `workspace.member.added.v1` | Member joined workspace | `workspaceId`, `userId`, `occurredAt` |
| `workspace.member.removed.v1` | Member removed | `workspaceId`, `userId`, `occurredAt` |

## Domain events

| Subject | Published when | Payload fields |
|---------|---------------|----------------|
| `domain.created.v1` | Domain identity provisioned in SES | `domainId`, `workspaceId`, `domain`, `occurredAt` |
| `domain.verify.poll.v1` | Verification poll enqueued (create or manual requeue) | `domainId`, `workspaceId`, `domain`, `requeued?`, `occurredAt` |
| `domain.verified.v1` | SES reports domain verified | `domainId`, `workspaceId`, `domain`, `occurredAt` |
| `domain.verification_failed.v1` | SES reports verification failed | `domainId`, `workspaceId`, `domain`, `occurredAt` |
| `domain.deleted.v1` | Domain soft-deleted | `domainId`, `workspaceId`, `domain`, `occurredAt` |

## Transactional email events

| Subject | Published when | Payload fields |
|---------|---------------|----------------|
| `email.send.transactional` | Transactional email queued (locked contract) | `jobId`, `workspaceId`, `sendId`, `to[]`, `from`, `replyTo?`, `subject`, `html?`, `text?`, `tags`, `provider` |

## Campaign events

| Subject | Published when | Payload fields |
|---------|---------------|----------------|
| `campaign.send.start` | Campaign send triggered (locked contract) | `jobId`, `workspaceId`, `campaignId`, `segmentId`, `sender`, `replyTo?`, `subject`, `html?`, `text?` |

## Segment events

| Subject | Published when | Payload fields |
|---------|---------------|----------------|
| `segment.refresh` | Segment created, updated, or manually refreshed (locked contract) | `workspaceId`, `segmentId` |

The Go worker subscribes to `segment.refresh`, evaluates the filter tree, updates `segment_memberships`, and sets `contact_count` + `last_computed` on the segment.

## Workflow events

| Subject | Published when | Payload fields |
|---------|---------------|----------------|
| `workflow.register` | Workflow published (locked contract) | `workspaceId`, `workflowId` |

The Go worker subscribes to `workflow.register` and registers the trigger listener so new contacts matching the trigger condition are enrolled into executions.

## Billing

Billing events are delivered via **Stripe webhooks** (`POST /api/v1/webhooks/stripe`), not NATS. See [api/billing.md](../api/billing.md#webhooks) for the full event list and security requirements.

## Consuming events

```typescript
import { connect, JSONCodec } from 'nats';

const nc = await connect({ servers: process.env.NATS_URL });
const codec = JSONCodec();
const sub = nc.subscribe('auth.user.registered.v1');

for await (const msg of sub) {
  const payload = codec.decode(msg.data);
  // handle...
}
```

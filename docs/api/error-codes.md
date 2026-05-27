# Error Codes

All errors follow the envelope:
```json
{ "error": { "code": "...", "message": "...", "details": null, "requestId": "uuid" } }
```

## 400 Bad Request

| Code | Meaning |
|------|---------|
| `VALIDATION_ERROR` | Request body / params failed Zod or Fastify schema validation. `details` contains an array of field-level issues. |
| `BAD_REQUEST` | Generic malformed request (e.g. unparseable JSON). |
| `INVALID_SCHEDULE_TIME` | `scheduledAt` is in the past or more than 1 year ahead. |
| `EMPTY_SEGMENT` | Campaign segment has zero estimated contacts. |
| `INVALID_WORKFLOW_GRAPH` | Workflow graph failed structural validation (cycle, missing trigger, disconnected node, etc.). |
| `INVALID_NODE` | A workflow node has an invalid type or missing required config. |
| `INVALID_EDGE` | A workflow edge references a non-existent node. |
| `INVALID_WORKFLOW_STATE` | Workflow is in a state that does not allow this operation (e.g. editing a published workflow). |
| `INVALID_SEGMENT_RULE` | Segment filter tree contains an unsupported operator or malformed rule. |
| `INVALID_PLAN` | The requested billing plan is unknown or not purchasable via this endpoint. |
| `WEBHOOK_SIGNATURE_INVALID` | Stripe webhook signature verification failed (bad secret, modified body, or missing header). |

## 401 Unauthorized

| Code | Meaning |
|------|---------|
| `UNAUTHORIZED` | No or malformed `Authorization` header. |
| `TOKEN_INVALID` | JWT signature invalid, expired, or opaque token not found / consumed. |
| `TOKEN_REVOKED` | JWT `jti` is in the Redis denylist (token was explicitly revoked). |
| `TOKEN_STALE` | JWT `iat` is older than `users.passwordChangedAt` — password was changed after this token was issued. |
| `TOKEN_REUSE` | Refresh token was presented after rotation — entire family revoked. |
| `INVALID_CREDENTIALS` | Email/password mismatch. |
| `ACCOUNT_LOCKED` | Too many failed login attempts. `details.retryAfterSeconds` indicates when to retry. |
| `ACCOUNT_DISABLED` | Account has been deactivated. |
| `INVITE_REQUIRES_LOGIN` | Invite email matches an existing account; must be authenticated to accept. |

## 403 Forbidden

| Code | Meaning |
|------|---------|
| `FORBIDDEN` | Authenticated but not allowed. |
| `EMAIL_NOT_VERIFIED` | Route requires a verified email. |
| `WORKSPACE_ACCESS_DENIED` | User is not a member of the requested workspace, or workspace does not exist. |
| `WORKSPACE_REQUIRED` | Workspace context missing (no `x-workspace-id` header). |
| `WORKSPACE_INACTIVE` | Workspace is deactivated; mutating operations are blocked. |
| `WORKSPACE_DELETED` | Workspace has been hard-deleted; cannot be reactivated. |
| `PERMISSION_DENIED` | User lacks one or more required permissions. `details.missing` lists them. |
| `INSUFFICIENT_ROLE` | User's role is below the minimum required, or below the target member's role. |
| `INVITE_EMAIL_MISMATCH` | Authenticated user's email does not match the invite. |
| `INVITE_ROLE_TOO_HIGH` | Invited role is at or above the inviter's role. |
| `NOT_OWNER` | Action requires the workspace owner. |
| `TARGET_NOT_MEMBER` | Transfer-ownership target is not a workspace member. |
| `USE_TRANSFER_OWNERSHIP` | Owner role cannot be assigned via PATCH; use the transfer-ownership endpoint. |
| `CANNOT_DEMOTE_OWNER` | Cannot change the owner role via PATCH. |
| `CANNOT_CHANGE_OWN_ROLE` | Cannot change your own membership role. |
| `CANNOT_ASSIGN_HIGHER_ROLE` | Cannot assign a role at or above your own. |
| `CANNOT_REMOVE_SELF` | Cannot remove yourself from a workspace. |
| `SOLE_OWNER_PROTECTED` | Cannot remove the only remaining owner. |
| `SENDER_DOMAIN_NOT_VERIFIED` | Sender email domain is not verified in this workspace. |
| `INVALID_SEGMENT` | Segment does not exist in this workspace. |
| `INVALID_CAMPAIGN_STATE` | Campaign is in a state that does not allow this operation. |
| `EMAIL_QUOTA_EXCEEDED` | Monthly transactional email quota exceeded for this workspace plan. |
| `ACTIVE_SUBSCRIPTION_REQUIRED` | Operation requires an active paid subscription (no subscription found). |
| `BILLING_FORBIDDEN` | Caller does not have permission to perform this billing operation. |

## 404 Not Found

| Code | Meaning |
|------|---------|
| `NOT_FOUND` | Resource does not exist or is not visible to the caller. |
| `DOMAIN_NOT_FOUND` | Domain does not exist in this workspace (or is soft-deleted). |
| `EMAIL_NOT_FOUND` | Transactional send not found in this workspace. |
| `TEMPLATE_NOT_FOUND` | Email template not found in this workspace. |
| `CAMPAIGN_NOT_FOUND` | Campaign not found in this workspace (or soft-deleted). |
| `CONTACT_NOT_FOUND` | Contact not found in this workspace (or soft-deleted). |
| `SEGMENT_NOT_FOUND` | Segment not found in this workspace (or soft-deleted). |
| `WORKFLOW_NOT_FOUND` | Workflow not found in this workspace (or soft-deleted). |

## 409 Conflict

| Code | Meaning |
|------|---------|
| `CONFLICT` | Generic conflict. |
| `EMAIL_TAKEN` | Email already registered. |
| `EMAIL_ALREADY_VERIFIED` | Email is already verified. |
| `ALREADY_MEMBER` | User is already a member of the workspace. |
| `SLUG_TAKEN` | Workspace slug is already in use. |
| `VERSION_CONFLICT` | Optimistic concurrency check failed; refetch and retry. |
| `DOMAIN_ALREADY_EXISTS` | Domain already registered for this workspace. |
| `DOMAIN_ALREADY_VERIFIED` | Domain is already verified; re-verification not needed. |
| `CAMPAIGN_NAME_TAKEN` | Campaign name already exists in this workspace. |
| `IDEMPOTENT_REPLAY` | Idempotency key reused with a different request body. |
| `CONTACT_ALREADY_EXISTS` | A contact with this email already exists in the workspace. |
| `WORKFLOW_ALREADY_PUBLISHED` | Workflow is already published, or a publish is already in progress. |

## 429 Too Many Requests

| Code | Meaning |
|------|---------|
| `RATE_LIMITED` | Rate limit exceeded. Check `retry-after` response header. |

## 500 Internal Server Error

| Code | Meaning |
|------|---------|
| `INTERNAL_ERROR` | Unexpected server error. Message is sanitized. Check server logs with `requestId`. |
| `STRIPE_ERROR` | Stripe API returned an unexpected error. Check server logs. |
| `STRIPE_NOT_CONFIGURED` | `STRIPE_SECRET_KEY` is not set; billing endpoints are unavailable. |

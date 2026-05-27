# RBAC Model

## Roles

| Role | Weight | Description |
|------|--------|-------------|
| `owner` | 100 | Full control — billing write, workspace deletion, all writes |
| `admin` | 75 | Manage members and content; billing read only; no workspace deletion |
| `member` | 50 | Read/write content; no billing or admin actions |
| `viewer` | 25 | Read-only across all resources |

A user has exactly one role per workspace. The role is stored on `workspace_members.role_id`.

## Permissions

| Permission | Owner | Admin | Member | Viewer |
|-----------|:-----:|:-----:|:------:|:------:|
| `workspace.read` | ✓ | ✓ | ✓ | ✓ |
| `workspace.write` | ✓ | ✓ | | |
| `workspace.delete` | ✓ | | | |
| `workspace.members.read` | ✓ | ✓ | ✓ | |
| `workspace.members.write` | ✓ | ✓ | | |
| `contacts.read` | ✓ | ✓ | ✓ | ✓ |
| `contacts.write` | ✓ | ✓ | ✓ | |
| `segments.read` | ✓ | ✓ | ✓ | ✓ |
| `segments.write` | ✓ | ✓ | ✓ | |
| `campaigns.read` | ✓ | ✓ | ✓ | ✓ |
| `campaigns.write` | ✓ | ✓ | ✓ | |
| `campaigns.send` | ✓ | ✓ | | |
| `workflows.read` | ✓ | ✓ | ✓ | ✓ |
| `workflows.write` | ✓ | ✓ | ✓ | |
| `workflows.publish` | ✓ | ✓ | | |
| `billing.read` | ✓ | ✓ | | ✓ |
| `billing.write` | ✓ | | | |
| `domains.read` | ✓ | ✓ | ✓ | ✓ |
| `domains.write` | ✓ | ✓ | | |
| `emails.send` | ✓ | ✓ | ✓ | |
| `emails.read` | ✓ | ✓ | ✓ | ✓ |
| `templates.read` | ✓ | ✓ | ✓ | ✓ |
| `templates.write` | ✓ | ✓ | ✓ | |
| `admin.read` | | | | |
| `admin.write` | | | | |

`admin.*` permissions are reserved for super-admin operations and are not assigned to any workspace role.

## Invite hierarchy rule

An inviter may only assign a role with **strictly lower weight** than their own:

| Inviter | Can invite as |
|---------|--------------|
| `owner` | `admin`, `member`, `viewer` |
| `admin` | `member`, `viewer` |
| `member` | `viewer` |
| `viewer` | *(cannot invite)* |

## How permissions are enforced

1. `workspaceGuard` middleware resolves the user's membership from the database and
   caches it in Redis (`rbac:{workspaceId}:{userId}`, TTL 60s).
2. `requirePermissions(...perms)` preHandler checks `request.permissions` (a `Set<Permission>`).
3. On any membership change, `rbac.invalidate()` deletes the cache key **and** publishes
   to the `rbac:invalidate` Redis channel so all replicas drop their copy immediately.

## Using permissions in routes

```typescript
import { requirePermissions } from '@http/middleware/rbac.js';
import { PERMISSIONS } from '@constants/rbac.js';

app.post('/campaigns', {
  preHandler: [
    app.authenticate,
    app.workspaceGuard,
    requirePermissions(PERMISSIONS.CAMPAIGNS_WRITE),
  ],
}, handler);
```

## Using role guards

```typescript
import { requireRole } from '@http/middleware/rbac.js';
import { ROLE_SLUGS } from '@constants/rbac.js';

app.delete('/workspace', {
  preHandler: [
    app.authenticate,
    app.workspaceGuard,
    requireRole(ROLE_SLUGS.OWNER),
  ],
}, handler);
```

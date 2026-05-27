# Workflows API

Create and manage automated contact journeys. The MVP supports a linear `trigger → email → delay → end` graph. Execution is handled by the Go worker.

All endpoints require `Authorization: Bearer <token>` and `x-workspace-id: <uuid>`.

## Permissions

| Action | Permission |
|--------|-----------|
| Read workflows / executions | `workflows.read` |
| Create / update / delete | `workflows.write` |
| Publish / pause / resume | `workflows.publish` |

## Workflow statuses

| Status | Description |
|--------|-------------|
| `draft` | Editable; not yet active |
| `published` | Active — new contacts entering the trigger will be enrolled |
| `paused` | Paused — no new enrollments; in-flight executions continue |
| `archived` | Soft-deleted |

## Endpoints

### POST /api/v1/workflows

Create a draft workflow. The graph is validated on creation.

**Request**
```json
{
  "name": "Trial Onboarding",
  "graph": {
    "nodes": [
      {
        "id": "trigger_1",
        "type": "trigger",
        "config": { "triggerType": "event", "eventName": "Trial Started" }
      },
      {
        "id": "email_1",
        "type": "email",
        "config": {
          "subject": "Welcome to your trial!",
          "fromEmail": "hello@acme.com",
          "fromName": "Acme",
          "html": "<h1>Welcome</h1>"
        }
      },
      {
        "id": "delay_1",
        "type": "delay",
        "config": { "durationSeconds": 86400 }
      },
      { "id": "end_1", "type": "end" }
    ],
    "edges": [
      { "from": "trigger_1", "to": "email_1" },
      { "from": "email_1", "to": "delay_1" },
      { "from": "delay_1", "to": "end_1" }
    ]
  }
}
```

**Response** `201`
```json
{ "workflow": { "id": "uuid", "name": "Trial Onboarding", "status": "draft", ... } }
```

**Errors** — `400 INVALID_WORKFLOW_GRAPH`

---

### GET /api/v1/workflows

List workflows with pagination.

**Query params** — `page` (default 1), `pageSize` (default 20, max 100)

**Response** `200`
```json
{ "items": [...], "page": 1, "pageSize": 20, "total": 3 }
```

---

### GET /api/v1/workflows/:id

Return full workflow including graph and execution summary.

**Response** `200`
```json
{
  "workflow": {
    "id": "uuid",
    "name": "Trial Onboarding",
    "status": "published",
    "graph": { "nodes": [...], "edges": [...] },
    "executionStats": { "total": 120, "completed": 98, "failed": 2, "running": 20 },
    ...
  }
}
```

**Errors** — `404 WORKFLOW_NOT_FOUND`

---

### PATCH /api/v1/workflows/:id

Update name or graph. Only allowed when status is `draft`.

**Request**
```json
{ "name": "New Name", "graph": { ... } }
```

**Errors** — `404 WORKFLOW_NOT_FOUND`, `400 INVALID_WORKFLOW_STATE` (not draft)

---

### POST /api/v1/workflows/:id/publish

Validate and publish the workflow. Transitions `draft` or `paused` → `published`.

Publishes a `workflow.register` NATS message so the Go worker registers the trigger.

**Response** `200` — updated workflow with `status: "published"`

**Errors** — `404 WORKFLOW_NOT_FOUND`, `409 WORKFLOW_ALREADY_PUBLISHED`, `400 INVALID_WORKFLOW_GRAPH`

---

### POST /api/v1/workflows/:id/pause

Pause a published workflow. No new contacts will be enrolled; in-flight executions continue.

**Response** `200` — updated workflow with `status: "paused"`

**Errors** — `400 INVALID_WORKFLOW_STATE` (not published)

---

### POST /api/v1/workflows/:id/resume

Resume a paused workflow. Transitions `paused` → `published`.

**Response** `200` — updated workflow with `status: "published"`

**Errors** — `400 INVALID_WORKFLOW_STATE` (not paused)

---

### DELETE /api/v1/workflows/:id

Soft-delete. Sets `deleted_at` and status to `archived`.

**Response** `204`

---

### GET /api/v1/workflows/:id/executions

List execution history for a workflow.

**Query params** — `page` (default 1), `pageSize` (default 20, max 100)

**Response** `200`
```json
{
  "items": [
    {
      "id": "uuid",
      "contactId": "uuid",
      "status": "completed",
      "currentNodeId": "end_1",
      "startedAt": "...",
      "completedAt": "...",
      ...
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 98
}
```

## Graph validation rules

The API enforces these rules on create, update, and publish:

- Exactly one `trigger` node
- At least one `end` node
- Valid DAG — no cycles
- All nodes reachable from the trigger
- All edge `from`/`to` references must exist
- Node configs validated per type (see below)

### Node types

#### trigger

```json
{
  "id": "trigger_1",
  "type": "trigger",
  "config": {
    "triggerType": "event",
    "eventName": "Trial Started"
  }
}
```

| Field | Required | Values |
|-------|----------|--------|
| `triggerType` | yes | `event`, `segment_enter`, `manual` |
| `eventName` | if `triggerType=event` | Event name string |

#### email

```json
{
  "id": "email_1",
  "type": "email",
  "config": {
    "subject": "Welcome!",
    "fromEmail": "hello@acme.com",
    "fromName": "Acme",
    "html": "<h1>Hello</h1>"
  }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `subject` | yes | |
| `fromEmail` | yes | Must be a verified domain |
| `fromName` | no | |
| `html` | yes (or `templateId`) | |
| `templateId` | yes (or `html`) | References an email template |

#### delay

```json
{ "id": "delay_1", "type": "delay", "config": { "durationSeconds": 86400 } }
```

| Field | Required | Constraints |
|-------|----------|-------------|
| `durationSeconds` | yes | Integer, min 60, max 31 536 000 (1 year) |

#### end

```json
{ "id": "end_1", "type": "end" }
```

No config required.

## NATS contract

On publish, the API publishes:

**Subject:** `workflow.register`

**Payload (locked):**
```json
{ "workspaceId": "uuid", "workflowId": "uuid" }
```

The Go worker subscribes, registers the trigger listener, and begins enrolling contacts.

## Workflow object

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid | |
| `workspaceId` | uuid | |
| `name` | string | |
| `status` | string | `draft` \| `published` \| `paused` \| `archived` |
| `triggerType` | string | Extracted from trigger node config |
| `triggerConfig` | object | Trigger node config snapshot |
| `graph` | object | Full node/edge graph |
| `version` | int | Optimistic concurrency token |
| `publishedAt` | ISO date | |
| `pausedAt` | ISO date | |
| `createdBy` | uuid | |
| `deletedAt` | ISO date | Null if active |
| `createdAt` | ISO date | |
| `updatedAt` | ISO date | |

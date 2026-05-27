# API Testing — Copy-Paste Commands

Base URL: `http://localhost:4000/api/v1`

> After each login/signup, copy the `accessToken` and `refreshToken` from the response.
> Replace `ACCESS_TOKEN`, `REFRESH_TOKEN`, `WORKSPACE_ID`, `MEMBER_ID`, `SESSION_ID`, `INVITE_TOKEN` with real values.

---

# AUTH

## 1. Health checks

```bash
curl http://localhost:4000/health
```

```bash
curl http://localhost:4000/ready
```

```bash
curl "http://localhost:4000/metrics?key=4fee8a4641dffe853649f070ce15336d34c181fed2470a348a33e171d80b30b4"
```

---

## 2. Signup

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"GoodPass!2345A","firstName":"Alice","lastName":"Smith","workspaceName":"Acme Corp"}' \
  | jq .
```

---

## 3. Login

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"GoodPass!2345A"}' \
  | jq .
```

---

## 4. Current user

```bash
curl -s http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  | jq .
```

---

## 5. Refresh token rotation

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"REFRESH_TOKEN"}' \
  | jq .
```

---

## 6. List sessions

```bash
curl -s http://localhost:4000/api/v1/auth/sessions \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  | jq .
```

---

## 7. Revoke a specific session

```bash
curl -s -X DELETE http://localhost:4000/api/v1/auth/sessions/SESSION_ID \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

---

## 8. Logout (revoke current session)

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/logout \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"REFRESH_TOKEN"}'
```

---

## 9. Logout all devices

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/logout-all \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  | jq .
```

---

## 10. Forgot password (no enumeration — always 202)

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com"}' \
  | jq .
```

---

## 11. Reset password (token from email)

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"RESET_TOKEN","password":"NewSecure!Pass234"}' \
  | jq .
```

---

## 12. Resend verification email

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/resend-verification \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  | jq .
```

---

## 13. Verify email (token from email)

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"token":"VERIFY_TOKEN"}' \
  | jq .
```

---

## 14. Invite a user to workspace

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/invites \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"email":"bob@example.com","role":"member"}' \
  | jq .
```

---

## 15. Accept invite — new user (no account yet)

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/accept-invite \
  -H "Content-Type: application/json" \
  -d '{"token":"INVITE_TOKEN","password":"GoodPass!2345A","firstName":"Bob","lastName":"Jones"}' \
  | jq .
```

---

## 16. Accept invite — existing user (must be logged in)

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/accept-invite \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"token":"INVITE_TOKEN"}' \
  | jq .
```

---

# WORKSPACES

## 17. Create workspace

```bash
curl -s -X POST http://localhost:4000/api/v1/workspaces \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Inc","plan":"free","metadata":{"industry":"saas"}}' \
  | jq .
```

---

## 18. List my workspaces

```bash
curl -s http://localhost:4000/api/v1/workspaces \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  | jq .
```

---

## 19. Get current workspace

```bash
curl -s http://localhost:4000/api/v1/workspaces/current \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 20. Update workspace (name/slug/metadata)

> Get the current `version` from a previous GET first; PATCH must echo it for optimistic concurrency.

```bash
curl -s -X PATCH http://localhost:4000/api/v1/workspaces/WORKSPACE_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Corp","version":1}' \
  | jq .
```

---

## 21. Switch active workspace

```bash
curl -s -X POST http://localhost:4000/api/v1/workspaces/switch \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"WORKSPACE_ID"}' \
  | jq .
```

The response contains a new `accessToken` whose `ws` claim is the target workspace.

---

## 22. Get workspace settings

```bash
curl -s http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/settings \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 23. Update workspace settings

```bash
curl -s -X PATCH http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/settings \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"timezone":"America/Los_Angeles","branding":{"primaryColor":"#5e3aff"},"featureFlags":{"ai_assist":true}}' \
  | jq .
```

---

## 24. List members

```bash
curl -s "http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/members?page=1&pageSize=20" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

With search + role filter:

```bash
curl -s "http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/members?search=bob&role=member" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 25. Update member role

```bash
curl -s -X PATCH http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/members/MEMBER_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}' \
  | jq .
```

`role` accepts `admin`, `member`, `viewer` (never `owner`).

---

## 26. Remove member

```bash
curl -s -X DELETE http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/members/MEMBER_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID"
```

---

## 27. Transfer ownership (owner only)

```bash
curl -s -X POST http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/transfer-ownership \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"newOwnerUserId":"NEW_OWNER_USER_ID"}' \
  | jq .
```

---

## 28. Deactivate workspace (owner only)

```bash
curl -s -X POST http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/deactivate \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 29. Reactivate workspace (owner or admin)

```bash
curl -s -X POST http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/reactivate \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

# NEGATIVE TESTS (expected failures)

## 30. Wrong password — 401 INVALID_CREDENTIALS

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"WrongPass!2345A"}' \
  | jq .
```

---

## 31. Duplicate signup — 409 EMAIL_TAKEN

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"GoodPass!2345A"}' \
  | jq .
```

---

## 32. No bearer token — 401

```bash
curl -s http://localhost:4000/api/v1/auth/me | jq .
```

---

## 33. Workspace not a member — 403 WORKSPACE_ACCESS_DENIED

```bash
curl -s http://localhost:4000/api/v1/workspaces/current \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: 11111111-1111-1111-1111-111111111111" \
  | jq .
```

---

## 34. Refresh reuse detection — 401 TOKEN_REUSE

```bash
# Step 1: rotate once
curl -s -X POST http://localhost:4000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"REFRESH_TOKEN"}' | jq .

# Step 2: use the OLD token again — family gets killed
curl -s -X POST http://localhost:4000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"REFRESH_TOKEN"}' | jq .
```

---

## 35. Optimistic concurrency conflict — 409 VERSION_CONFLICT

```bash
# Send a stale version on PATCH
curl -s -X PATCH http://localhost:4000/api/v1/workspaces/WORKSPACE_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"name":"X","version":999}' \
  | jq .
```

---

## 36. Member self-removal — 403 CANNOT_REMOVE_SELF

```bash
curl -s -X DELETE http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/members/MY_MEMBER_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID"
```

---

## 37. Demoting owner via PATCH — 403 CANNOT_DEMOTE_OWNER

```bash
curl -s -X PATCH http://localhost:4000/api/v1/workspaces/WORKSPACE_ID/members/OWNER_MEMBER_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"role":"member"}' \
  | jq .
```

---

## 38. Mutating a deactivated workspace — 403 WORKSPACE_INACTIVE

```bash
# After deactivating, any mutating call returns 403
curl -s -X PATCH http://localhost:4000/api/v1/workspaces/WORKSPACE_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"name":"X","version":2}' \
  | jq .
```

---

# DOMAINS

## 39. Create a sending domain

```bash
curl -s -X POST http://localhost:4000/api/v1/domains \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"domain":"acme.com"}' \
  | jq .
```

---

## 40. List domains

```bash
curl -s "http://localhost:4000/api/v1/domains?page=1&pageSize=20" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

Filter by status:

```bash
curl -s "http://localhost:4000/api/v1/domains?status=verified" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 41. Get domain by id

```bash
curl -s http://localhost:4000/api/v1/domains/DOMAIN_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 42. Requeue verification (manual)

```bash
curl -s -X POST http://localhost:4000/api/v1/domains/DOMAIN_ID/verify \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 43. Delete domain

```bash
curl -s -X DELETE http://localhost:4000/api/v1/domains/DOMAIN_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID"
```

---

## 44. Invalid domain — 400 VALIDATION_ERROR

```bash
curl -s -X POST http://localhost:4000/api/v1/domains \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"domain":"localhost"}' \
  | jq .
```

---

## 45. Duplicate domain — 409 DOMAIN_ALREADY_EXISTS

```bash
# Run command 39 twice with the same domain
curl -s -X POST http://localhost:4000/api/v1/domains \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"domain":"acme.com"}' \
  | jq .
```

---

## 46. Cross-workspace domain access — 403 WORKSPACE_ACCESS_DENIED

```bash
# Use a domain id from workspace A but supply workspace B's id
curl -s http://localhost:4000/api/v1/domains/DOMAIN_ID_FROM_WS_A \
  -H "Authorization: Bearer WS_B_ACCESS_TOKEN" \
  -H "x-workspace-id: WS_B_ID" \
  | jq .
```

---

# TRANSACTIONAL EMAILS

## 47. Send a transactional email (raw)

```bash
curl -s -X POST http://localhost:4000/api/v1/emails/send \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"to":[{"email":"alice@example.com","name":"Alice"}],"from":{"email":"hello@acme.com","name":"Acme"},"replyTo":"support@acme.com","subject":"Welcome","html":"<h1>Hello</h1>","text":"Hello","tags":{"source":"signup"},"idempotencyKey":"signup-alice-1"}' \
  | jq .
```

---

## 48. Idempotency replay (same key, same body → same sendId)

```bash
# Run command 47 again — returns same sendId without re-queuing
curl -s -X POST http://localhost:4000/api/v1/emails/send \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"to":[{"email":"alice@example.com","name":"Alice"}],"from":{"email":"hello@acme.com","name":"Acme"},"subject":"Welcome","html":"<h1>Hello</h1>","idempotencyKey":"signup-alice-1"}' \
  | jq .
```

---

## 49. List sends

```bash
curl -s "http://localhost:4000/api/v1/emails?status=queued&pageSize=10" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 50. Get send by id

```bash
curl -s http://localhost:4000/api/v1/emails/SEND_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 51. Create + publish email template

```bash
curl -s -X POST http://localhost:4000/api/v1/email-templates \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"name":"Welcome","subject":"Welcome {{first_name}}","htmlBody":"<h1>Hello {{first_name}}</h1>","textBody":"Hello {{first_name}}","variables":{"first_name":"string"},"publish":true}' \
  | jq .
```

---

## 52. Send using template

```bash
curl -s -X POST http://localhost:4000/api/v1/emails/send \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"to":[{"email":"alice@example.com"}],"from":{"email":"hello@acme.com"},"templateId":"TEMPLATE_ID","templateData":{"first_name":"Alice"}}' \
  | jq .
```

---

## 53. Update template (clones published → new draft)

```bash
curl -s -X PATCH http://localhost:4000/api/v1/email-templates/TEMPLATE_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Updated {{first_name}}","publish":true}' \
  | jq .
```

---

## 54. Delete template

```bash
curl -s -X DELETE http://localhost:4000/api/v1/email-templates/TEMPLATE_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID"
```

---

# CAMPAIGNS

## 55. Create campaign

```bash
curl -s -X POST http://localhost:4000/api/v1/campaigns \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"name":"Welcome Campaign","type":"regular","subject":"Welcome to Acme","previewText":"Get started","from":{"email":"hello@acme.com","name":"Acme"},"replyTo":"support@acme.com","html":"<h1>Hello</h1>","text":"Hello","segmentId":"SEGMENT_ID"}' \
  | jq .
```

---

## 56. List campaigns

```bash
curl -s "http://localhost:4000/api/v1/campaigns?status=draft&pageSize=20" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 57. Get campaign

```bash
curl -s http://localhost:4000/api/v1/campaigns/CAMPAIGN_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 58. Update campaign (requires version)

```bash
curl -s -X PATCH http://localhost:4000/api/v1/campaigns/CAMPAIGN_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Updated Subject","version":1}' \
  | jq .
```

---

## 59. Schedule campaign

```bash
curl -s -X POST http://localhost:4000/api/v1/campaigns/CAMPAIGN_ID/schedule \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"scheduledAt":"2026-12-01T10:00:00Z"}' \
  | jq .
```

---

## 60. Send campaign now

```bash
curl -s -X POST http://localhost:4000/api/v1/campaigns/CAMPAIGN_ID/send \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 61. Pause campaign

```bash
curl -s -X POST http://localhost:4000/api/v1/campaigns/CAMPAIGN_ID/pause \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 62. Resume campaign

```bash
curl -s -X POST http://localhost:4000/api/v1/campaigns/CAMPAIGN_ID/resume \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

## 63. Delete campaign

```bash
curl -s -X DELETE http://localhost:4000/api/v1/campaigns/CAMPAIGN_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID"
```

---

## 64. Stale version conflict — 409 VERSION_CONFLICT

```bash
curl -s -X PATCH http://localhost:4000/api/v1/campaigns/CAMPAIGN_ID \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  -H "Content-Type: application/json" \
  -d '{"subject":"X","version":999}' \
  | jq .
```

---

## 65. Send with empty segment — 400 EMPTY_SEGMENT

```bash
# Ensure the segment has estimatedCount=0, then:
curl -s -X POST http://localhost:4000/api/v1/campaigns/CAMPAIGN_ID/send \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "x-workspace-id: WORKSPACE_ID" \
  | jq .
```

---

# REFERENCE

## Swagger UI

Open in browser:
```
http://localhost:4000/docs
```

# API Documentation — Index

This is the entry point for the backend HTTP API. Per-module endpoint references live in
sibling files in this folder:

- [API_MAIN.md](./API_MAIN.md) — Authentication (Microsoft SSO + Teams SSO), Users & Roles,
  API Keys, Notifications, Feedback, Presence
- [API_CRM.md](./API_CRM.md) — Organizations, Inquiries, Tenders, Activities, Notes,
  Documents, workflow sub-entities, Dashboard, Bulk Import
- [API_ERP.md](./API_ERP.md) — Projects, Service Requests (materials, attachments,
  raise-PR). **Note:** there is no separate "service" module — Service Requests live
  inside `erp` (`backend/app/modules/erp/routes/service_requests.py`).
- [API_PURCHASE.md](./API_PURCHASE.md) — the `purchase` module: processes PRs that were
  *raised from* an ERP Service Request.
- [API_P2P.md](./API_P2P.md) — the `p2p`
  module: a second, independent P2P request workflow that any user can raise directly (not
  tied to a Service Request), with its own buyer-assignment/vendor-selection/PO lifecycle.
  **`purchase` and `p2p` are two distinct modules** — see that file's
  top section for the full distinction.
- [API_RND.md](./API_RND.md) — R&D calculation tools (braking, hydraulic, load
  distribution, Qmax, spline, tractive effort, vehicle performance) + calculation history

For the broader system design, data model, and the fuller RBAC/permissions model, see
[../architecture/](../architecture/), [../database/](../database/), and
[../security/](../security/) (linked here for navigation; those folders are maintained
separately from this one).

## Base URL

```
http://localhost:8000        (dev)
```

No API-level path prefix beyond `/api/v1` — see "Mounting" below. The old draft of this
file claimed a separate production hostname (`api.premnathrail.com`); that is not
confirmed anywhere in the codebase (no such value in `app/core/config.py`) and has been
removed rather than repeated unverified.

## Mounting (from `backend/app/main.py`)

`app = FastAPI(title=settings.app_name, description="...", version="1.0.0")` — **no**
custom `docs_url`/`openapi_url` is passed, so Swagger UI is at the FastAPI default
`/docs` and the OpenAPI schema at `/openapi.json`.

Every module router is included with `prefix="/api/v1"` (the router's own `prefix=` is
appended on top of that), except RnD's two routers which are included with
`prefix="/api/v1/rnd"` in addition to their own `prefix=`:

| Router | Own prefix | Final mounted prefix |
|---|---|---|
| `auth_routes` | `/auth` | `/api/v1/auth` |
| `users_routes` | `/users` | `/api/v1/users` |
| `erp_projects_routes` | `/erp/projects` | `/api/v1/erp/projects` |
| `erp_sr_routes` | `/erp/service-requests` | `/api/v1/erp/service-requests` |
| `purchase_requisitions_routes` | `/purchase/requisitions` | `/api/v1/purchase/requisitions` |
| `p2p_requests_routes` | `/p2p/requests` | `/api/v1/p2p/requests` |
| `crm_organizations_routes` | `/crm/organizations` | `/api/v1/crm/organizations` |
| `crm_inquiries_routes` | `/crm/inquiries` | `/api/v1/crm/inquiries` |
| `crm_tenders_routes` | `/crm/tenders` | `/api/v1/crm/tenders` |
| `crm_activities_routes` | `/crm/activities` | `/api/v1/crm/activities` |
| `crm_notes_routes` | `/crm/notes` | `/api/v1/crm/notes` |
| `crm_documents_routes` | `/crm/documents` | `/api/v1/crm/documents` |
| `crm_workflow_routes` | `/crm` | `/api/v1/crm/*` (tasks/approvals/quotations/POs/competitors/discussions) |
| `crm_dashboard_routes` | `/crm/dashboard` | `/api/v1/crm/dashboard` |
| `crm_bulk_import_routes` | `/crm/admin/import` | `/api/v1/crm/admin/import` |
| `notifications_routes` | `/notifications` | `/api/v1/notifications` |
| `feedback_routes` | `/feedback` | `/api/v1/feedback` |
| `api_keys_routes` | `/api-keys` | `/api/v1/api-keys` |
| `presence_routes` | `/presence` | `/api/v1/presence` |
| `rnd_calculations_routes` (no own prefix, sub-routers add `/tools/<tool>`) | — | `/api/v1/rnd/tools/<tool>/...` |
| `rnd_history_routes` | `/history` | `/api/v1/rnd/history` |

Two non-API routes at the app root (not under `/api/v1`): `GET /health` and `GET /`
(basic info). `/static/*` is mounted for public assets (e.g. the logo used in outgoing
emails) and is explicitly exempted from the auth pre-check in `OWASPMiddleware`.

## Authentication — three ways in, checked in this order

`get_current_user` (`backend/app/modules/main/routes/auth.py`) tries, **in this exact
order**, stopping at the first match:

1. **`X-API-Key: pew_<raw key>`** header (also accepted as `Authorization: Bearer pew_<raw key>`
   — `get_api_key_record` in `backend/app/middleware/api_key.py` doesn't care which header
   carried it, it just extracts `X-API-Key` specifically — see Note below). Hashed with
   SHA-256 and looked up against `APIKey.key_hash` where `is_active=True`; on match, a
   throwaway in-memory `User(id=0, role="api_service", assigned_apps=key.allowed_apps)`
   stands in for the caller for that request only (never persisted).
2. **`session_token` httponly cookie** — set by the Microsoft-login/Teams-SSO flows.
3. **`Authorization: Bearer <jwt>`** header — decoded/verified as a normal login JWT.

**Note / correction vs. the previous draft of this file:** the old doc described these
three as interchangeable alternatives with equal standing. They are not — API-key lookup
is tried first and, on a match, entirely bypasses JWT/cookie logic; only if no API key is
present does it fall through to cookie-then-Bearer-JWT. Also, `get_api_key_record` reads
**only** the literal `X-API-Key` header (see
`backend/app/middleware/api_key.py:43`) — sending the raw key via `Authorization: Bearer
pew_...` does **not** hit the API-key path; it would only work by falling through to the
JWT-Bearer branch, which will reject it (it isn't a JWT). **In practice, `X-API-Key:
pew_...` is the only working way to authenticate with an API key** — treat the old doc's
"or `Authorization: Bearer pew_...`" claim as incorrect unless someone confirms otherwise.

A confirmed, real two-part API-key system exists (this was explicitly worth verifying,
per the task brief):
- **Management** (`backend/app/modules/main/routes/api_keys.py`, admin-only): create/list/revoke.
- **Validation middleware** (`backend/app/middleware/api_key.py`): a separate function,
  `get_api_key_record`, called from `get_current_user` on every request, that actually
  checks an incoming `X-API-Key` header against the DB. These are two distinct pieces of
  code and both exist — the management endpoints are not the whole story.

See [API_MAIN.md](./API_MAIN.md) for the full login/SSO flow, Users & Roles, and API Keys
endpoint reference.

## Authorization model (brief — see `docs/security/` for the full model)

- **Module gate:** `require_app_access(app_name)` (`backend/app/core/permissions.py`)
  requires `app_name` in `user.get_apps()`; admins always pass.
- **ERP sub-permissions:** `has_erp_permission(user, permission)` — a granular list
  (`project_view/create/edit/delete`, `sr_view/create/edit/delete`) stored on
  `User.erp_permissions`, enforced only inside the `erp` module; admins bypass.
  CRM, RnD, Purchase, and Purchase Requisition have no such sub-breakdown — whole-module
  access only.
- **Ownership:** several routes (CRM records, ERP Service Requests, PR Requests' own-PR
  view) additionally require the caller to be the record's creator, unless they're an
  admin or (for PR Requests) on the `purchase` team.

## Error conventions

No global custom exception schema was found beyond FastAPI's default
`{"detail": "..."}` — every `HTTPException` across the codebase sets `detail` to a
plain string. Status codes actually used in this codebase (grepped across
`backend/app/modules/*/routes/*.py`): **400, 401, 403, 404, 409, 422, 423, 429, 500,
502, 503**, plus success codes **200, 201, 204, 302**. Notable ones beyond the generic
CRUD set:
- **409 Conflict** — used pervasively for state-machine violations (e.g. approving a PR
  that isn't `submitted`, editing a closed/cancelled PR) and for duplicate-record
  creation (duplicate org name/GST, duplicate tender number+zone+division).
- **423 Locked** — `erp/service_requests.py` (updating a Service Request in a state
  that blocks edits).
- **429 Too Many Requests** — `/auth/microsoft-login` when the pending-OAuth-state cache
  is full.
- **502/503** — used for upstream-integration failures (SharePoint not configured / a
  SharePoint call failing; Microsoft Graph errors on Azure user sync; Teams OBO exchange).
- **400** is also used for `/auth/callback`'s expired/invalid OAuth `state` and for
  `/auth/teams-*` malformed-token cases, not just body-validation errors.

There is no dedicated global exception-handler module beyond
`app/middleware/error_handler.py` (`setup_error_handlers`), which was not further
inspected for message-shaping beyond what's described above — see
`backend/app/middleware/error_handler.py` directly if you need the exact shape.

## Webhooks

**None.** `grep -i webhook` across `backend/` returns no matches — this application does
not expose or consume any webhooks. (No dedicated file was created for this; noting it
here per the task brief so nobody invents a webhooks doc later.)

## Rate limiting

Not a global framework feature — `OWASPMiddleware` (`backend/app/middleware/owasp.py`)
implements IP-based rate limiting + bans as part of its OWASP-Top-10 protections, and
`/auth/microsoft-login` separately caps pending OAuth states at 500 (`429` beyond that).
No per-user/per-key rate limit was found for regular API routes.

## Testing

```bash
curl http://localhost:8000/health
curl -H "Authorization: Bearer <jwt>" http://localhost:8000/api/v1/auth/me
```

Swagger UI: `http://localhost:8000/docs` (default FastAPI path, not customized).

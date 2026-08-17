# API — Main Module (`app/modules/main`)

Covers authentication/SSO, Users & Roles, API Keys, Notifications, Feedback, Presence.
All paths below are relative to `/api/v1` unless noted (auth routes are also mounted
there: `/api/v1/auth/...`, despite older docs showing bare `/auth/...`).

## Authentication (`routes/auth.py`, prefix `/auth`) — 6 routes

| Method & Path | Description | Auth |
|---|---|---|
| `GET /auth/microsoft-login` | Redirects to Microsoft's OAuth login page. Generates a single-use `state` (capped at 500 pending, 10 min TTL). `503` if Azure app not configured; `429` if the pending-state cache is full. | none |
| `GET /auth/callback?code&state` | OAuth callback. Exchanges code for a Graph token, fetches the profile, upserts/creates the local `User`, checks `DOMAIN_EMAIL` allow-list and `is_active`, then redirects to the frontend with the session delivered as an httponly `session_token` cookie (never in the URL). Error redirects (`.../login?error=unauthorized` / `?error=inactive`) set no cookie. `400` for invalid/expired/reused `state`. | none |
| `POST /auth/teams-token` — body `{ "token": "<teams-sso-jwt>" }` | Silent sign-on inside a Teams tab. Validates the token Teams' `getAuthToken()` returns (JWKS signature, audience/issuer, replay protection via `jti`), then best-effort On-Behalf-Of exchange for a Graph delegated token. `400` malformed token, `401` bad signature/audience/replay, `403` domain/inactive. | none |
| `POST /auth/teams-exchange` — body `{ "code": "..." }` | Main-Teams-frame side of the popup hand-off: exchanges a one-time code (120s TTL, single-use) minted by `/auth/callback` for the same session cookies. `400` otherwise. | none |
| `GET /auth/me` | Returns the caller's own user record (`CurrentUserResponse`). | any authenticated caller |
| `POST /auth/logout` | Clears session cookies (see route body for exact cookie names cleared). | any authenticated caller |

Session cookies: `session_token` (httponly, 24h `max_age`, `Secure`/`SameSite` driven by
`settings.SECURE_COOKIES`) and, when the Graph OBO exchange succeeds, `ms_access_token`
(httponly, 1h). `samesite="none"` when `SECURE_COOKIES` is true, else `"lax"`.

**Note:** the Teams popup fallback flow (regular `/auth/microsoft-login` →
`/auth/callback` run inside a Teams popup, detected via `next_path ==
/auth/teams-success`, issuing a one-time code instead of a cookie) is implemented as a
special case inside `/auth/callback`, not a separate route.

## Users & Roles (`routes/users.py`, prefix `/users`) — 6 routes, admin-only

All require `require_admin` (caller's `role == "admin"`; else `403`).

| Method & Path | Description |
|---|---|
| `GET /users` | List all users, ordered by name. Adds a computed `apps` field: admins get `["crm","erp","rnd"]` regardless of `assigned_apps`; everyone else gets `assigned_apps` verbatim. Response: `list[UserResponse]`. |
| `GET /users/directory` | A lighter directory listing (`list[dict]`) — not further inspected beyond its signature; read `routes/users.py:70` for exact fields if needed. |
| `PATCH /users/{user_id}` | Update `name`/`role`/`assigned_apps`/`erp_permissions`. `400` on unknown role/app/permission id, or on an admin trying to demote themself. `erp_permissions` only takes effect when `"erp"` is in `assigned_apps`; valid ids: `project_view`, `project_create`, `project_edit`, `project_delete`, `sr_view`, `sr_create`, `sr_edit`, `sr_delete`. |
| `PATCH /users/{user_id}/deactivate` | `400` if targeting self. Deactivated users fail `get_current_user` (`401`) on their next request even with a valid JWT — `is_active` is re-checked per request. |
| `PATCH /users/{user_id}/activate` | Reactivate. |
| `POST /users/sync-azure` | Pulls every enabled tenant member via Graph (app-only client-credentials token), upserts locally, promotes tenant Global Admins to `role="admin"`, deactivates Azure-linked local users no longer active in the tenant. `503` with the Graph error in `detail` on misconfiguration. Returns the refreshed `list[UserResponse]`. |

### Enforcement of `erp_permissions` (cross-reference — see API_ERP.md for the routes themselves)

- `project_create` → `POST /erp/projects`; `project_edit` → `PATCH /erp/projects/{id}`
  and `POST /erp/projects/{id}/attachments`; `project_delete` → `DELETE
  /erp/projects/{id}` and `DELETE /erp/projects/{id}/attachments/{id}`.
- `sr_create` → `POST /erp/service-requests`; `sr_edit`/`sr_delete` further require the
  caller be the SR's creator (or admin) — see API_ERP.md.

## API Keys (`routes/api_keys.py`, prefix `/api-keys`) — 3 routes, admin-only

For external systems that can't do interactive OAuth. A key authenticates like a user
scoped to `allowed_apps`, in-memory `role="api_service"` (see API.md's Authentication
section for full precedence/behavior — this is the **management** side only).

| Method & Path | Description |
|---|---|
| `GET /api-keys` | List keys — `response_model=list[APIKeyResponse]`; never returns the raw key or its hash. |
| `POST /api-keys` | Body: `{ name, allowed_apps: [...] }`. Generates the raw key (`generate_api_key()` in `app/middleware/api_key.py`, prefixed `pew_`) and its SHA-256 hash; stores only the hash. Response (`APIKeyCreatedResponse`) includes the raw `api_key` — shown exactly once, `201`. |
| `PATCH /api-keys/{key_id}/revoke` | Sets `is_active=False`. |

Validation of an incoming key on other routes is handled separately by
`get_api_key_record()` in `app/middleware/api_key.py` (called from
`get_current_user`) — see API.md.

## Notifications (`routes/notifications.py`, prefix `/notifications`) — 4 routes

| Method & Path | Description |
|---|---|
| `GET /notifications/unread-count` | Count of the caller's unread notifications. |
| `GET /notifications` | List the caller's notifications. |
| `PATCH /notifications/{notification_id}/read` | Mark one as read. |
| `PATCH /notifications/read-all` | Mark all of the caller's notifications as read. |

All require `get_current_user` (any authenticated caller — scoped to their own rows;
no module gate).

## Feedback (`routes/feedback.py`, prefix `/feedback`) — 4 routes

| Method & Path | Description |
|---|---|
| `POST /feedback` | Submit feedback. `201`, `response_model=FeedbackResponse`. |
| `GET /feedback/unread-count` | Unread feedback count (admin-facing). |
| `GET /feedback` | List feedback — `response_model=list[FeedbackResponse]`. |
| `PATCH /feedback/{feedback_id}/read` | Mark as read. `404` if not found. |

Auth dependency on the list/read routes was not confirmed to be admin-restricted vs.
any-authenticated-user in this pass — **Note:** verify `Depends(...)` on
`list_feedback`/`mark_as_read` directly in `routes/feedback.py` before relying on this
being open to non-admins; the file's `require_admin`-equivalent gate wasn't grepped in
this doc pass and is left unconfirmed rather than guessed.

## Presence (`routes/presence.py`, prefix `/presence`) — 2 routes

Used by SR/Project detail pages for a live "N others viewing" indicator — in-memory,
polling-based, no websocket.

| Method & Path | Description |
|---|---|
| `POST /presence/heartbeat` | Body: `{ resource_type: "sr"\|"project", resource_id }`. `204`. Call every ~30s while a detail page is open. |
| `GET /presence/{resource_type}/{resource_id}` | Returns other users currently viewing that resource (caller excluded). |

Both require `get_current_user` only (any authenticated caller, no module gate — makes
sense since it just reflects who else is looking, not module-gated data).

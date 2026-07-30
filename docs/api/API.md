# API Documentation

## Base URL
```
http://localhost:8000
```

Production: `https://api.premnathrail.com`

## Authentication

Protected endpoints accept any of:

```
Authorization: Bearer <jwt_token>      # API clients / tooling
Cookie: session_token=<jwt_token>      # browser sessions (httponly, set by /auth/callback and /auth/teams-*)
X-API-Key: pew_<key>                   # service accounts — see API Keys Endpoints below
```

The browser-facing login flow (`/auth/microsoft-login` → `/auth/callback`) delivers the
JWT as an httponly cookie, not in the redirect URL — this avoids exposing the token in
browser history/referrer headers and to any JS running on the page.

## Endpoints

### Health Check

**Check if server is running**

```
GET /health
```

**Response (200):**
```json
{
  "status": "ok",
  "app": "Premnathrail Portal"
}
```

---

## Authentication Endpoints

### Start Microsoft Login

**Redirect user to Microsoft login**

```
GET /auth/microsoft-login
```

**Behavior:**
- Redirects to Microsoft login page
- After user authenticates, Microsoft redirects back to `/auth/callback`
- Frontend receives `access_token` in response

**Response (302 Redirect):**
- Redirects to: `https://login.microsoftonline.com/...`

---

### OAuth Callback

**Handle Microsoft OAuth callback** (auto-handled by browser/server)

```
GET /auth/callback?code=<auth_code>&state=<state>
```

**Response (302 Redirect)** to `{FRONTEND_URL}<next_path>`, with the session
delivered as an httponly `session_token` cookie (not in the URL).

**Error redirects** (no cookie set):
- `{FRONTEND_URL}/login?error=unauthorized` — email domain not in `DOMAIN_EMAIL`
- `{FRONTEND_URL}/login?error=inactive` — account exists but `is_active=false`

**State parameter:** issued by `/auth/microsoft-login`, single-use, capped at 500
pending states and expires after 10 minutes — `/callback` returns `400` for an
unknown, reused, or expired state.

---

### Teams SSO

**Silent sign-on from inside a Microsoft Teams tab** — validates the token Teams'
`microsoftTeams.authentication.getAuthToken()` API hands back (JWKS signature check,
audience/issuer validation, replay protection via `jti`), then attempts an
On-Behalf-Of exchange for a Graph delegated token (best-effort — login still
succeeds if this fails).

```
POST /auth/teams-token
Body: { "token": "<teams-sso-jwt>" }
```

**Response (200):** `{ "ok": true }`, with `session_token` (and `ms_access_token`
if the OBO exchange succeeded) set as httponly cookies.

**Errors:** `400` missing/malformed token · `401` wrong audience/issuer, invalid
signature, or already-used token (replay) · `403` domain not authorized / account
deactivated.

**Teams popup flow** — for contexts where `getAuthToken()` isn't available, the
regular `/auth/microsoft-login` → `/auth/callback` redirect flow runs inside a
Teams popup, and `/auth/callback` detects a `next_path` of `/auth/teams-success`
to redirect with a one-time `code` instead of a cookie (popup cookies are
isolated from the main Teams frame). The main frame then exchanges it:

```
POST /auth/teams-exchange
Body: { "code": "<one-time-code-from-teams-success-redirect>" }
```

**Response (200):** `{ "ok": true }`, session cookies set in the main frame.
The code is single-use and expires after 120 seconds — `400` otherwise.

---

### Get Current User

**Fetch logged-in user info**

```
GET /auth/me
```

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "id": 1,
  "email": "john@premnathrail.com",
  "name": "John Doe",
  "role": "user",
  "is_active": true
}
```

**Errors:**
- `401` — Token missing, invalid, or expired
- `404` — User not found or inactive

---

## Users & Roles Endpoints (admin only)

All endpoints below require the caller's JWT to belong to a user with `role` of
`admin` or `super_admin` (enforced by the `require_admin` dependency). A non-admin
caller gets `403 Forbidden`.

### List Users

```
GET /api/v1/users
```

Returns every user in the local database, ordered by name. Each user includes
a computed `apps` field: admins/super_admins always get `["crm","erp","rnd"]`
regardless of `assigned_apps`; everyone else gets exactly `assigned_apps`.

**Response (200):**
```json
[
  {
    "id": 1,
    "email": "jane@premnathrail.com",
    "name": "Jane Doe",
    "role": "user",
    "is_active": true,
    "designation": "Sr. Engineer",
    "department": "R&D",
    "phone": null,
    "assigned_apps": ["rnd"],
    "erp_permissions": [],
    "apps": ["rnd"],
    "is_azure_admin": false
  }
]
```

### Update a User

```
PATCH /api/v1/users/{user_id}
```

Body (all fields optional): `{ "name": "...", "role": "user|admin|super_admin", "assigned_apps": ["erp","rnd","crm"], "erp_permissions": ["project_view", "project_delete"] }`

- Rejects unknown role values or unknown app names with `400`.
- A `super_admin` cannot demote their own account via this endpoint (`400`).
- `erp_permissions` is a granular sub-permission list that only applies when `"erp"` is in
  `assigned_apps` — R&D Tools and CRM don't have a sub-permission breakdown, just the
  whole-module toggle. Valid ids: `project_view`, `project_create`, `project_edit`,
  `project_delete`, `sr_view`, `sr_create`, `sr_edit`, `sr_delete`. Rejects unknown ids
  with `400`. Admins/super_admins bypass this entirely (see enforcement below).
- Enforced server-side on every corresponding endpoint (not just read by the frontend
  to show/hide nav items and buttons):
  - `project_create` → `POST /erp/projects`; `project_edit` → `PATCH /erp/projects/{id}`
    and `POST /erp/projects/{id}/attachments`; `project_delete` →
    `DELETE /erp/projects/{id}` and `DELETE /erp/projects/{id}/attachments/{id}`.
  - `sr_create` → `POST /erp/service-requests`. `sr_edit` → `PATCH /erp/service-requests/{id}`,
    uploading an attachment, and adding/updating a material. `sr_delete` →
    `DELETE /erp/service-requests/{id}` and deleting an attachment/material.
    Both `sr_edit` and `sr_delete` additionally require the caller to be the SR's
    creator (or an admin) — see [service-requests.md](#service-requests) below.
  - All return `403` when missing, except admins/super_admins, who bypass every check.

### Deactivate / Activate a User

```
PATCH /api/v1/users/{user_id}/deactivate
PATCH /api/v1/users/{user_id}/activate
```

- An admin cannot deactivate their own account (`400`).
- Deactivated users fail `get_current_user` on their next request (`401`), even
  with a still-valid JWT — every protected route re-checks `is_active`.

### Sync Users from Azure AD

```
POST /api/v1/users/sync-azure
```

Pulls every enabled member of the Azure AD tenant via Microsoft Graph
(app-only client-credentials token — no signed-in delegated token needed) and
upserts them into the local `users` table: creates missing users, refreshes
name/designation/department/phone for existing ones, promotes tenant Global
Administrators to the `admin` role, and deactivates any Azure-linked local user
who is no longer active in the tenant. Returns the full, refreshed user list.

**Note:** this endpoint calls out to `https://graph.microsoft.com`. If the
Azure app registration's client credentials are misconfigured, or the tenant
denies the required application permissions, it returns `503` with the Graph
error message in `detail`.

---

## API Keys Endpoints (admin only)

For external systems / service integrations that can't do the interactive OAuth
flow. A key authenticates like a user scoped to `allowed_apps`, with `role="api_service"`.

```
GET    /api/v1/api-keys                List keys (never returns the raw key or its hash)
POST   /api/v1/api-keys                Create — body: { name, allowed_apps: [...] }
                                        Response includes `api_key` (raw, "pew_...") — shown once, never again
PATCH  /api/v1/api-keys/{id}/revoke    Deactivate
```

Use the raw key as `X-API-Key: pew_...` or `Authorization: Bearer pew_...` on any
protected endpoint.

---

## Error Responses

### 400 Bad Request
```json
{
  "detail": "Invalid request data"
}
```

### 401 Unauthorized
```json
{
  "detail": "Missing or invalid token"
}
```

### 403 Forbidden
```json
{
  "detail": "You don't have permission"
}
```

### 404 Not Found
```json
{
  "detail": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "detail": "Internal server error"
}
```

---

## Status Codes

| Code | Meaning |
|------|---------|
| 200  | Success |
| 201  | Created |
| 204  | No Content |
| 400  | Bad Request |
| 401  | Unauthorized |
| 403  | Forbidden |
| 404  | Not Found |
| 500  | Server Error |

---

## Token Format

JWT tokens have 3 parts: `header.payload.signature`

**Decoded payload example:**
```json
{
  "sub": "1",
  "email": "john@premnathrail.com",
  "role": "user",
  "exp": 1627847062
}
```

**exp** = Expiration timestamp (UNIX). Token valid for 24 hours.

---

## Rate Limiting

TBD — to be implemented

---

## Pagination

TBD — will be used for list endpoints

Example:
```
GET /api/v1/crm/notes?skip=0&limit=10
```

---

## CRM Module Endpoints

All routes below require `Authorization: Bearer <token>` for a user whose `assigned_apps`
includes `"crm"` (admins/super_admins always pass). Mutating routes (`PATCH`/`DELETE`) also
require the caller to be the record's creator or an admin/super_admin — otherwise `403`.

### Organizations

```
GET    /api/v1/crm/organizations                 List (filters: search, railway_zone)
GET    /api/v1/crm/organizations/search-name?q=  Live duplicate-name lookup (top 10 matches)
POST   /api/v1/crm/organizations                 Create (409 on duplicate name or GST number)
GET    /api/v1/crm/organizations/{id}
GET    /api/v1/crm/organizations/{id}/detail      Includes contacts[], inquiry_count, tender_count
PATCH  /api/v1/crm/organizations/{id}
DELETE /api/v1/crm/organizations/{id}             Soft delete, cascades to its Inquiries/Tenders
POST   /api/v1/crm/organizations/{id}/restore
GET    /api/v1/crm/organizations/recycle-bin/list
GET    /api/v1/crm/organizations/{id}/audit
GET    /api/v1/crm/organizations/{id}/contacts
POST   /api/v1/crm/organizations/{id}/contacts
PATCH  /api/v1/crm/organizations/{id}/contacts/{contact_id}
DELETE /api/v1/crm/organizations/{id}/contacts/{contact_id}
```

### Inquiries

```
GET    /api/v1/crm/inquiries                     List (filters: search, status, org_id)
POST   /api/v1/crm/inquiries                     Auto-generates universal_id: INQ-YYYYMMDD-####
GET    /api/v1/crm/inquiries/{id}
PATCH  /api/v1/crm/inquiries/{id}                Changing current_stage auto-logs a stage entry + notification
DELETE /api/v1/crm/inquiries/{id}
POST   /api/v1/crm/inquiries/{id}/restore
GET    /api/v1/crm/inquiries/recycle-bin/list
GET    /api/v1/crm/inquiries/{id}/audit
GET    /api/v1/crm/inquiries/{id}/stages         Full stage-change timeline
POST   /api/v1/crm/inquiries/{id}/stages         Manually append a stage entry (also updates current_stage)
```

Stage vocabulary (`current_stage`, forward-only 15 steps): `Customer Requirement → Design →
R&D → Costing → Management Approval → Quotation Submission → Purchase Order → Project →
Manufacturing → Inspection → Dispatch → Installation → Commissioning → Warranty → Service`

### Tenders

```
GET    /api/v1/crm/tenders                       List (filters: search, status, org_id)
POST   /api/v1/crm/tenders                       Auto-generates universal_id: TND-YYYYMMDD-####
                                                  409 if tender_number+railway_zone+division already exists
GET    /api/v1/crm/tenders/{id}
PATCH  /api/v1/crm/tenders/{id}
DELETE /api/v1/crm/tenders/{id}
POST   /api/v1/crm/tenders/{id}/restore
GET    /api/v1/crm/tenders/recycle-bin/list
GET    /api/v1/crm/tenders/{id}/audit
GET    /api/v1/crm/tenders/{id}/stages
POST   /api/v1/crm/tenders/{id}/stages
```

Stage vocabulary (12 steps): `Tender Published → Documents Downloaded → Participate Decision →
Design Started → Costing Completed → Technical Offer Prepared → Commercial Offer Prepared →
Management Approval → Bid Submitted → Technical Qualified → Financial Opened → Awarded / Lost`

### Activities & Notes

```
GET    /api/v1/crm/activities   (filters: search, status, org_id, related_module, related_id)
POST   /api/v1/crm/activities
PATCH  /api/v1/crm/activities/{id}
DELETE /api/v1/crm/activities/{id}

GET    /api/v1/crm/notes        (filters: search, org_id, related_module, related_id)
POST   /api/v1/crm/notes
PATCH  /api/v1/crm/notes/{id}
DELETE /api/v1/crm/notes/{id}
```

**Follow-up reminders:** an Activity with `next_followup` set and `status: "Open"`
automatically gets an in-app notification sent one day before that date and again
on the day itself — see `app/tasks/followup_reminders.py`, scheduled daily at
8:00 AM IST (`app/main.py`). The target user is resolved by matching `assigned_to`
(free text) against a real user's name (case-insensitive); if there's no match —
or `assigned_to` is blank — it falls back to the activity's creator. Notification
types: `activity_followup_due_today`, `activity_followup_due_tomorrow`. This is a
batch job, not instant — saving an activity due today won't trigger a notification
until the next scheduled run.

### Documents (SharePoint-backed)

Reuses the same SharePoint integration as the ERP module's project/service-request
attachments. Requires `SHAREPOINT_SITE_ID` to be configured server-side — every route
below returns `503 { "detail": "SharePoint site is not configured" }` otherwise.

```
GET    /api/v1/crm/documents?related_module=inquiry&related_id=42
       Optional: related_sub_module, related_sub_id

POST   /api/v1/crm/documents          multipart/form-data
       Fields: related_module*, related_id*, folder_type* ("client"|"internal"),
               doc_category, related_sub_module, related_sub_id, universal_id, org_id,
               description, files* (one or more)
       Returns: list[CrmDocumentResponse], one per uploaded file

DELETE /api/v1/crm/documents/{id}
       Best-effort SharePoint delete (logged, not fatal), then soft-deletes the DB row
```

`doc_category` options: `RFQ, Tender Notice, BOQ, Technical Specifications, Drawings,
Cost Sheet, Quotation, Purchase Documents, Approval Documents, Other`.

**Example — upload with curl:**
```bash
curl -X POST http://localhost:8000/api/v1/crm/documents \
  -H "Authorization: Bearer <token>" \
  -F "related_module=inquiry" \
  -F "related_id=42" \
  -F "folder_type=client" \
  -F "doc_category=RFQ" \
  -F "files=@spec.pdf"
```

### Inquiry/Tender workflow sub-entities

Nested under their parent — same permission rule as everything else (creator or admin
for mutations):

```
GET/POST            /api/v1/crm/inquiries/{id}/tasks
PATCH/DELETE         /api/v1/crm/inquiries/{id}/tasks/{task_id}
GET/POST             /api/v1/crm/tenders/{id}/tasks
PATCH/DELETE         /api/v1/crm/tenders/{id}/tasks/{task_id}

GET/POST             /api/v1/crm/inquiries/{id}/approvals
PATCH/DELETE         /api/v1/crm/inquiries/{id}/approvals/{approval_id}
       Setting status to Approved/Rejected auto-stamps approved_by_id/name/approved_at

GET/POST             /api/v1/crm/inquiries/{id}/quotations
PATCH/DELETE         /api/v1/crm/inquiries/{id}/quotations/{quot_id}

GET/POST             /api/v1/crm/inquiries/{id}/purchase-orders
GET/POST             /api/v1/crm/tenders/{id}/purchase-orders
PATCH/DELETE         /api/v1/crm/purchase-orders/{po_id}

GET/POST             /api/v1/crm/tenders/{id}/competitors
PATCH/DELETE         /api/v1/crm/tenders/{id}/competitors/{comp_id}

GET/POST             /api/v1/crm/inquiries/{id}/discussions
GET/POST             /api/v1/crm/tenders/{id}/discussions
```

### Dashboard

```
GET /api/v1/crm/dashboard
```

Returns `total_organizations`, `total_inquiries`, `total_tenders`, `open_followups`
(Activity status=Open), `overdue_followups` (Open + next_followup < today),
`today_activities`, `pending_tenders` (status in Active/Submitted), `recent_notes_count`,
plus `recent_organizations`/`recent_inquiries`/`recent_tenders` (last 5 each).

---

### ERP Endpoints

All routes below require `Authorization: Bearer <token>` (or the `session_token` cookie)
for a user whose `assigned_apps` includes `"erp"` (admins/super_admins always pass).
Beyond that module-level gate, every create/edit/delete route also requires the matching
`erp_permissions` entry — see [Users & Roles](#users--roles-endpoints-admin-only) above
for the full enforcement breakdown, and the per-route notes below.

#### Projects

```
GET    /api/v1/erp/projects                          List (filters: search, status,
                                                       application_type, client_company, skip/limit)
GET    /api/v1/erp/projects/filter-options            Distinct values for the filter dropdowns
POST   /api/v1/erp/projects                           Create — requires project_create/admin
GET    /api/v1/erp/projects/{id}
PATCH  /api/v1/erp/projects/{id}                      Requires project_edit/admin
DELETE /api/v1/erp/projects/{id}                      Soft delete — requires project_delete/admin
POST   /api/v1/erp/projects/{id}/restore
GET    /api/v1/erp/projects/recycle-bin/list
GET    /api/v1/erp/projects/{id}/audit
GET    /api/v1/erp/projects/{id}/attachments
POST   /api/v1/erp/projects/{id}/attachments          multipart/form-data — SharePoint-backed;
                                                       requires project_edit/admin
DELETE /api/v1/erp/projects/{id}/attachments/{attachment_id}  Requires project_delete/admin
```

#### Service Requests

Unlike Projects, `sr_edit`/`sr_delete` alone aren't enough — the caller must also be the
SR's creator (admins bypass this too). `sr_create`/`sr_edit`/`sr_delete` have no ownership
requirement for creation itself, obviously, but do for editing/deleting an existing one.

```
GET    /api/v1/erp/service-requests                   List
POST   /api/v1/erp/service-requests                   Create — requires sr_create/admin
GET    /api/v1/erp/service-requests/recycle-bin
GET    /api/v1/erp/service-requests/{id}
PATCH  /api/v1/erp/service-requests/{id}               Requires sr_edit + creator (or admin)
DELETE /api/v1/erp/service-requests/{id}               Requires sr_delete + creator (or admin)
POST   /api/v1/erp/service-requests/{id}/restore
GET    /api/v1/erp/service-requests/{id}/audit
POST   /api/v1/erp/service-requests/{id}/attachments   multipart/form-data — SharePoint-backed;
                                                        requires sr_edit + creator (or admin)
DELETE /api/v1/erp/service-requests/{id}/attachments/{attachment_id}  Requires sr_delete + creator (or admin)
GET    /api/v1/erp/service-requests/{id}/materials
POST   /api/v1/erp/service-requests/{id}/materials     Requires sr_edit + creator (or admin)
PATCH  /api/v1/erp/service-requests/{id}/materials/{mat_id}  Requires sr_edit + creator (or admin)
DELETE /api/v1/erp/service-requests/{id}/materials/{mat_id}  Requires sr_delete + creator (or admin)
GET    /api/v1/erp/service-requests/{id}/purchase-users
POST   /api/v1/erp/service-requests/{id}/resend-client-email
POST   /api/v1/erp/service-requests/{id}/send-purchase-email
```

#### Presence ("who's viewing this")

Used by the SR/Project detail pages to show a live "N others viewing" indicator.
In-memory, polling-based (no websocket) — see [ARCHITECTURE.md](../architecture/ARCHITECTURE.md).

```
POST   /api/v1/presence/heartbeat                     Body: { resource_type: "sr"|"project", resource_id }
                                                        Call every 30s while the detail page is open
GET    /api/v1/presence/{resource_type}/{resource_id}  Returns other users currently viewing (self excluded)
```

### RnD Endpoints

**Not yet ported to this rebuild.** The legacy app exposes seven calculation
tools (braking, hydraulic, load distribution, Qmax, spline, tractive effort,
vehicle performance) plus a shared calculation-history log, all under
`/api/v1/rnd/*`. Porting these tools (and wiring `app/modules/rnd` into
`main.py`) is tracked separately — the module currently only has empty
scaffolding in Ideal. Once ported, the shape mirrors legacy:

```
POST   /api/v1/rnd/{tool}_calculate           e.g. /rnd/braking_calculate — one per tool
POST   /api/v1/rnd/{tool}_report_pdf
POST   /api/v1/rnd/{tool}_download_docx       (spline only)

POST   /api/v1/rnd/history/save               Save a named calculation result
GET    /api/v1/rnd/history/list               Caller's own saved calculations
GET    /api/v1/rnd/history/admin/list         All users' saved calculations (admin only)
GET    /api/v1/rnd/history/admin/users        Distinct users who have saved calculations (admin only)
GET    /api/v1/rnd/history/detail/{calc_id}
PATCH  /api/v1/rnd/history/rename/{calc_id}
DELETE /api/v1/rnd/history/delete/{calc_id}
```

---

## Testing with cURL

### Health check
```bash
curl http://localhost:8000/health
```

### Get current user
```bash
curl -H "Authorization: Bearer <token>" \
     http://localhost:8000/auth/me
```

---

## Testing with Swagger UI

Visit: `http://localhost:8000/docs`

- Click on endpoint
- Click "Try it out"
- Enter parameters
- Click "Execute"
- See response

---

## Frontend Integration Example

```javascript
// 1. Redirect to login
function login() {
  window.location.href = 'http://localhost:8000/auth/microsoft-login';
}

// 2. After Microsoft redirects back, /auth/callback has already set the
//    session_token httponly cookie — nothing to store client-side.
//    `credentials: 'include'` is required so the cookie is sent cross-origin.

// 3. Make API calls
async function getMe() {
  const response = await fetch('http://localhost:8000/auth/me', {
    credentials: 'include',
  });
  return response.json();
}
```

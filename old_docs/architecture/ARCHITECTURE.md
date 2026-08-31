# System Architecture

## Overview

**Premnathrail Portal** is a **modular monolith** — a single application with well-defined module boundaries that can eventually be split into microservices.

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Browser)                      │
│              HTML/CSS/JS → Vue/React (later)               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ HTTP/REST
                     │
        ┌────────────▼────────────────┐
        │      FastAPI Application    │
        │  ┌──────────────────────┐   │
        │  │  Authentication      │   │
        │  │  (Microsoft SSO)     │   │
        │  └──────────────────────┘   │
        │  ┌──────────────────────┐   │
        │  │  Routes / Endpoints  │   │
        │  │  ├─ /auth/*                        │   │
        │  │  ├─ /api/v1/users, /notifications  │   │
        │  │  ├─ /api/v1/erp/*                  │   │
        │  │  ├─ /api/v1/purchase-requisitions/* │   │
        │  │  ├─ /api/v1/p2p/*                   │   │
        │  │  ├─ /api/v1/crm/*                  │   │
        │  │  └─ /api/v1/rnd/*                  │   │
        │  └──────────────────────┘   │
        │  ┌──────────────────────┐   │
        │  │  Services Layer      │   │
        │  │  (Business Logic)    │   │
        │  └──────────────────────┘   │
        │  ┌──────────────────────┐   │
        │  │ Repositories Layer   │   │
        │  │ (Database Access)    │   │
        │  └──────────────────────┘   │
        └────────────────┬─────────────┘
                         │
                         │ psycopg
                         │
        ┌────────────────▼─────────────┐
        │   PostgreSQL Database        │
        │  ├─ users table             │
        │  ├─ crm_* tables            │
        │  ├─ erp_* tables            │
        │  └─ rnd_* tables            │
        └─────────────────────────────┘
```

## Request Flow

1. **Frontend** sends HTTP request: `POST /api/v1/crm/notes` with data
2. **Route handler** receives request, validates input (Pydantic schema)
3. **Service layer** executes business logic (check permissions, validate, etc.)
4. **Repository layer** executes database query
5. **Response schema** converts data to JSON
6. **Frontend** receives JSON response

### Example: Create CRM Note

```
POST /api/v1/crm/notes
{
  "title": "Call customer",
  "description": "Follow up on quote"
}
│
├─ Route handler receives request
│  └─ Validate input (CreateNoteSchema)
│
├─ Service.create_note(user_id, data)
│  └─ Check: user has CRM access?
│  └─ Check: data is valid?
│  └─ Call repository
│
├─ Repository.create(email, title, description, ...)
│  └─ INSERT INTO crm_notes (...)
│  └─ Return created note
│
├─ Service returns NoteResponse
│
└─ Route returns 201 Created with note JSON
```

## Layer Responsibilities

### Routes Layer
- **Receives** HTTP requests, query parameters, headers
- **Validates** input using Pydantic schemas
- **Calls** service methods
- **Returns** response (JSON or error)
- **Does NOT** query database directly
- **Does NOT** contain business logic

Example:
```python
@router.post("/notes", response_model=NoteResponse)
def create_note(data: CreateNoteSchema, service: NoteService = Depends(get_service)):
    return service.create_note(data)
```

### Services Layer
- **Executes** business logic
- **Validates** data (beyond schema validation)
- **Checks** permissions, rules, constraints
- **Calls** repositories for database access
- **Returns** data (not HTTP responses)
- **Does NOT** know about HTTP requests/responses
- **Does NOT** execute SQL queries

Example:
```python
def create_note(self, data: CreateNoteSchema) -> NoteResponse:
    if not data.title:
        raise ValueError("Title required")
    note = self.repo.create(data.title, data.description)
    return NoteResponse.model_validate(note)
```

### Repositories Layer
- **Executes** SQL queries
- **Reads/writes** to database
- **Returns** ORM model instances
- **Does NOT** contain business logic
- **Does NOT** know about HTTP
- **Does NOT** validate data (assumes input is valid)

Example:
```python
def create(self, title: str, description: str) -> Note:
    note = Note(title=title, description=description)
    self.db.add(note)
    self.db.commit()
    return note
```

### Models Layer
- **Define** database table structure
- **SQLAlchemy** ORM models
- **Columns** and relationships
- **No** methods or business logic

Example:
```python
class Note(Base):
    __tablename__ = "crm_notes"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str]
    description: Mapped[str]
```

### Schemas Layer
- **Define** request/response shapes
- **Pydantic** models
- **Validation** rules
- **No** database knowledge

Example:
```python
class CreateNoteSchema(BaseModel):
    title: str
    description: str

class NoteResponse(BaseModel):
    id: int
    title: str
    description: str
```

## Module Structure

> **Note:** the separate repositories/services layers described below (and earlier in
> this doc) were the original plan. As actually built, both the ERP and CRM modules use
> a flatter, simpler convention — route handlers query the DB session directly via
> SQLAlchemy, with no separate repository/service classes. This keeps the modules small
> and easy to follow; revisit the layered approach only if a module's route file grows
> unwieldy. Tests live under the shared `backend/app/tests/` directory (not per-module),
> matching pytest's existing fixture setup (`client`, `db`).

As of this writing, `backend/app/modules/` contains six modules (verified against the
imports/routers wired up in `backend/app/main.py`):

| Module | Path | Purpose |
|---|---|---|
| `main` | `app/modules/main/` | Users, Microsoft SSO auth (`routes/auth.py`), audit log, notifications, feedback, API keys, presence |
| `erp` | `app/modules/erp/` | Projects, Service Requests, Service Materials (+ their SharePoint-backed attachments) |
| `crm` | `app/modules/crm/` | Organizations, Inquiries, Tenders, Activities, Notes, Documents, workflow (tasks/approvals/quotations/POs), dashboard |
| `purchase` | `app/modules/purchase/` | Purchase Requisitions **raised from an ERP Service Request's materials** — tightly coupled to `erp` (imports `Project`/`ServiceRequest` models, mirrors status back onto `ServiceMaterial`). See "Purchase Module" below. |
| `p2p` | `app/modules/p2p/` | A **separate, newer, standalone** P2P request workflow for any department (not just ERP/Service). Tables `p2p_requests`/`p2p_request_items`/`p2p_request_attachments`. Does not import anything from `erp` or `purchase` — see ADR 0003. |
| `rnd` | `app/modules/rnd/` | R&D calculation tools (braking, hydraulic, load distribution, Qmax, spline, tractive effort, vehicle performance) + calculation history |

There is **no** `app/modules/service/` directory in the current codebase — grepped and
confirmed absent. "Service" in this codebase refers to the ERP module's **Service
Request** feature (`app/modules/erp/models/service_request.py`,
`app/modules/erp/routes/service_requests.py`), not a separate module. If you see
"service module" referenced elsewhere, it almost certainly means this.

Each feature module (CRM, ERP, RnD) follows this actual pattern:

```
backend/app/modules/crm/
├── __init__.py
├── models/
│   ├── __init__.py           # re-exports every model for app/main.py to import
│   ├── organization.py       # Organization, OrgContact
│   ├── inquiry.py            # Inquiry, InquiryTask, InquiryApproval, Quotation
│   ├── tender.py             # Tender, TenderTask, TenderCompetitor
│   ├── purchase_order.py     # PurchaseOrder (shared by Inquiry & Tender)
│   ├── activity.py
│   ├── note.py
│   ├── document.py           # CrmDocument (SharePoint-backed)
│   ├── discussion.py         # CrmDiscussion
│   └── stage_log.py          # CrmStageLog
├── schemas/
│   ├── organization.py, inquiry.py, tender.py, activity.py, note.py,
│   │   document.py, workflow.py (tasks/approvals/quotations/POs/competitors/
│   │   discussions/stage-logs), dashboard.py
├── routes/
│   ├── organizations.py, inquiries.py, tenders.py, activities.py, notes.py,
│   │   documents.py, workflow.py (all nested sub-entity routes), dashboard.py
```

`app/tests/test_crm.py`, `app/tests/test_crm_documents.py`, `app/tests/test_crm_activities.py`,
and `app/tests/test_crm_activity_attachments.py` cover this module; see
[TESTING.md](../testing/TESTING.md) for how to run them.

### Activity photos

Each `Activity` has a SharePoint-backed photo gallery (`crm_activity_attachments` table —
same pointer/metadata-only pattern as `ServiceMaterialAttachment` in the Purchase/ERP
modules). Photos can be added from the Activity form itself (create or edit) via
`POST /crm/activities/{id}/attachments`, and are visible everywhere that activity is
listed or viewed — the Organization's Activities tab, the Inquiry's Activities tab, and
the Activities list page's detail view — since `_enrich()` in `routes/activities.py`
attaches them to every `ActivityResponse`, not just the upload response.

### Why the Organization's Activities tab joins through Inquiry/Tender

`Activity.org_id` is stamped once, at creation time. If the Activity was logged against
an Inquiry/Tender and that record is *later* reassigned to a different Organization
(e.g. a data-entry correction), `Activity.org_id` doesn't follow — it silently goes
stale, and an Organization's Activities tab that trusted it alone would miss activities
that objectively belong to it now. `list_activities()`'s `org_id` filter therefore
ORs the direct `Activity.org_id == org_id` match with a subquery check — does this
activity's `related_module`/`related_id` point at an Inquiry or Tender whose *current*
`org_id` is this org? — so the tab reflects the Inquiry/Tender's present ownership, not
a frozen snapshot. See `test_org_activities_include_inquiry_activities_with_stale_org_id`
in `test_crm_activities.py` for the exact scenario this guards against.

## Purchase Module

Raised from a Service Request's Materials tab, a Purchase Requisition (PR) tracks a set
of materials through the Purchase department's workflow (approve → PO → receive → close)
independently of the SR's own status. It lives at `backend/app/modules/purchase/` and
follows the same models/schemas/routes layout as CRM/ERP above, plus a `service.py` for
the status-transition logic shared between its own routes and the ERP routes that raise
a PR / mark a material received.

**Lifecycle:**
```
submitted → approved → po_raised → partially_received → received → closed
        \→ rejected                                  \→ cancelled
```
`partially_received`/`received` are computed automatically — see below — every other
transition is an explicit Purchase-side action (`POST .../approve|reject|cancel|close`).

**Why a module, not a separate app (yet):** the request explicitly asked for Purchase to
eventually be its own deployable application, so this module is deliberately built with a
clean seam rather than reaching into ERP internals:
- It never imports ERP *route* code, only two ERP *models* (`Project`, `ServiceRequest`),
  purely to read display fields (client, site, SR number) — no writes.
- The only write it makes back into ERP is a small denormalized mirror
  (`ServiceMaterial.pr_id` / `pr_number` / `pr_status`), kept in sync by
  `purchase/service.py::sync_material_pr_fields()` whenever a PR's status changes. That
  function is the exact seam that would become an outbound webhook call if Purchase were
  ever extracted into its own service — the rest of the module (models, routes, status
  logic) would move unchanged.
- ERP's side of the integration is symmetric: `service_requests.py`'s `raise-pr` and
  `.../materials/{id}/receive` routes call into `purchase/service.py`'s plain functions
  rather than duplicating PR logic — that's the inbound half of the same seam.

**Who marks what:** Purchase raises/approves/sets PO details/closes. The **service
user** (SR creator, or admin) marks physical receipt on the SR's own Materials tab
(`POST /erp/service-requests/{id}/materials/{mat_id}/receive`) — they're the ones who can
actually see the goods arrive at site. Receiving is additive/partial: each call sets an
absolute `received_quantity` (clamped to the material's ordered quantity), and the parent
PR's status is recomputed after every call — `partially_received` while any item is short,
`received` once every item matches its requested quantity. A PR can only be `closed` once
it reaches `received`.

`app/tests/test_purchase_requisitions.py` covers this module end-to-end (raising a PR,
approve/reject/cancel, partial/full receiving, closing, item remarks/photos) — see
[TESTING.md](../testing/TESTING.md).

**Item remarks & photos:** each `PurchaseRequisitionItem` has a free-text `remarks`
column (`PATCH .../items/{item_id}`) and a **read-only** photo gallery — Purchase can
view a material's photos but cannot add or delete them; that's deliberately kept as an
ERP-side-only action on the Service Request's Materials tab
(`POST/DELETE /erp/service-requests/{sr_id}/materials/{mat_id}/attachments`), since the
service team is the one physically handling the part. The gallery isn't a separate
table — `_to_response()` in `purchase_requisitions.py` loads each item's linked
`ServiceMaterial` with `selectinload(ServiceMaterial.attachments)` and maps the existing
`ServiceMaterialAttachment` rows onto `PurchaseRequisitionItemResponse.attachments`, so a
photo uploaded from the SR side shows up on the PR item automatically with no sync step
and no purchase-side upload/delete route.

## Standalone P2P Module (`p2p`)

Distinct from the "Purchase Module" above, `app/modules/p2p/` is a
**fully independent** P2P request workflow any department can use directly (not only
Service Requests raised via ERP): `POST /api/v1/p2p/requests` lets any user
with the `p2p` app raise a request against a free-text `project_label`,
attach items, and route it to an approver; the `purchase` app grants processing access
(assign buyer, quotations, vendor selection, PO creation, receiving). Access gating is
in `routes/p2p_requests.py::_requester_or_purchase()`.

Its models (`models/p2p_request.py`, `p2p_request_item.py`, `p2p_request_attachment.py`)
import nothing from `erp` or `purchase` — confirmed by inspection, there is no
cross-module model import, unlike the `purchase` module's deliberate two-model read-only
coupling to ERP described below. See ADR 0003 for why this was built as a clean second
module rather than folding the "any department" use case into the existing `purchase`
module.

Attachments (`P2PRequestAttachment`) go through the same `app/utils/sharepoint.py`
helper as every other SharePoint-backed upload in this codebase — see
`routes/p2p_requests.py`'s `upload_attachments()` (around line 528), which calls
`upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)`.

## Authentication & Authorization

### Flow (browser, `backend/app/modules/main/routes/auth.py`):
1. User goes to `GET /api/v1/auth/microsoft-login` — backend generates a CSRF `state`
   token (server-side in-memory dict, not a cookie, to dodge SameSite issues) and
   redirects to the Microsoft identity platform authorize URL
2. User authenticates with Microsoft (MFA, conditional access, etc. all handled by
   Microsoft — the app never sees credentials)
3. Microsoft redirects back to `GET /api/v1/auth/callback?code=...&state=...`
4. Backend validates `state`, exchanges `code` for an access token
   (`app/auth/microsoft.py::exchange_code_for_token`), fetches the profile from
   Microsoft Graph (`get_microsoft_user_profile`)
5. Optionally enforces `settings.DOMAIN_EMAIL` (restrict to `@premnathrail.com`)
6. Auto-provisions the user on first login or syncs name/department/designation/phone
   on every subsequent login
7. Backend mints its own JWT (`create_access_token`) and redirects to the frontend,
   setting it as an httponly `session_token` cookie (see below)

There is a **separate, parallel flow for Microsoft Teams** (the app is also installed
as a Teams tab): `POST /api/v1/auth/teams-token` validates a Teams `getAuthToken()` SSO
token directly against Azure AD's JWKS (signature + issuer + tenant + audience +
replay checks, see `_check_replay`/`_jwks_cache` in `auth.py`) and starts a session
without any redirect — plus an On-Behalf-Of exchange for a Graph delegated token used by
Teams-specific Graph calls. A third variant (`/auth/callback` → `teams-exchange`)
hands off the redirect-based flow's result into a Teams popup via a short-lived
one-time code, since popup cookie jars are isolated from the main Teams frame.

### Token Usage:
- Browser sessions: JWT delivered as an httponly `session_token` cookie by
  `/auth/callback`, `/auth/teams-token`, and `/auth/teams-exchange` — never exposed to
  page JS. The frontend's `useAuthStore` (`frontend/src/store/authStore.ts`) therefore
  treats the fetched `user` object, not a locally-held token, as the "am I logged in"
  signal.
- API clients / tooling: `Authorization: Bearer <token>` header (same JWT, same
  `get_current_user` dependency in `auth.py` — cookie is checked first, then the header)
- A third path exists for server-to-server integrations: an `X-API-Key` header,
  resolved by `app/middleware/api_key.py::get_api_key_record` and checked *before* the
  cookie/JWT path in `get_current_user` — it maps to an in-memory service-account `User`
  (`id=0`, role `api_service`) scoped to whatever apps the key was granted.
- Token expires after 24 hours (`ACCESS_TOKEN_EXPIRE_MINUTES`)

## Database Schema

### Main Tables
- `users` — Portal users, role, Azure profile. Also carries a few dormant
  columns inherited from the legacy production schema (`hashed_password`,
  `must_change_password`, `encrypted_graph_refresh_token`) that have no
  reader/writer in this codebase yet — see the security note in
  `app/modules/main/models/user.py`. Do not treat their presence as evidence
  of a local-password auth path; see Security → Authentication below.
- `notifications` — per-user in-app notifications generated as a side effect
  of ERP/CRM events (see `app/modules/main/models/notification.py`).
- `feedback` — free-text feedback/suggestions submitted by any user via the
  "Feedback" nav item (`app/modules/main/models/feedback.py`,
  `routes/feedback.py`). `POST /api/v1/feedback` is open to any authenticated
  user; `GET /feedback`, `GET /feedback/unread-count`, and
  `PATCH /feedback/{id}/read` are admin-only (`require_admin`, shared with
  `routes/users.py`). Reviewed via the `FeedbackBell` component on the Users
  & Roles page (`frontend/src/components/FeedbackBell.tsx`), which polls
  `/feedback/unread-count` every 30s the same way `NotificationBell` does.

### CRM Tables
- `crm_organizations`, `crm_org_contacts`
- `crm_inquiries`, `crm_inquiry_tasks`, `crm_inquiry_approvals`, `crm_quotations`
- `crm_tenders`, `crm_tender_tasks`, `crm_tender_competitors`
- `crm_purchase_orders` (shared by Inquiry & Tender)
- `crm_activities`, `crm_notes`
- `crm_documents` (SharePoint pointer/metadata only — file bytes live in SharePoint)
- `crm_discussions`, `crm_stage_logs` (both polymorphic via `related_module`/`related_id`,
  attachable to either an Inquiry or a Tender)

### ERP Tables
- `erp_projects`, `erp_project_attachments`
- `erp_service_requests`, `erp_service_materials`, `erp_service_request_attachments`
  - `erp_service_materials` additionally carries the Purchase Requisition mirror:
    `pr_id`, `pr_number`, `pr_status`, `received_quantity`, `receiving_status`

### Purchase Tables
- `purchase_requisitions` — one row per PR (`pr_number`, `status`, `project_id` /
  `service_request_id` links, vendor/PO/delivery fields)
- `purchase_requisition_items` — line items, snapshotted from `erp_service_materials`
  at the moment the PR is raised, tracking `quantity_requested` vs `quantity_received`,
  plus a `remarks` text column (added in `a2d5e8f1c3b7_add_pr_item_remarks`). Photos are
  not stored here — see "Item remarks & photos" above.

### RnD Tables
`app/modules/rnd` is fully implemented (this corrects an earlier "not yet ported" note —
verified via `__tablename__` in `app/modules/rnd/models/tool_calculations.py`):
- `rnd_braking_calculations`, `rnd_hydraulic_calculations`,
  `rnd_load_distribution_calculations`, `rnd_qmax_calculations`,
  `rnd_spline_calculations`, `rnd_tractive_effort_calculations`,
  `rnd_vehicle_performance_calculations` — one table per tool, each storing that
  tool's specific input parameters + computed results
- `calculation_history` — cross-tool save/rename/list/delete log, one row per
  named save regardless of which tool produced it

### Standalone P2P Tables (`p2p` module)
- `p2p_requests` — one row per standalone P2P request (`p2p_number`, `category_code`,
  `project_label` free text, `department`, `requested_by_id`, `approver_id`, status)
- `p2p_request_items` — line items (`item_name`, `part_code`, `model_number`, `unit`,
  `quantity`, `estimated_budget`, `reason`)
- `p2p_request_attachments` — SharePoint pointer/metadata rows, same pattern as
  `crm_documents`/`ServiceMaterialAttachment` elsewhere in the codebase

This is a **separate table set** from the `purchase_requisitions`/
`purchase_requisition_items` tables used by the ERP-coupled `purchase` module above —
the similar naming is a common source of confusion; they are not related by foreign key.

## Background Jobs / Scheduled Tasks

`app/tasks/` holds functions that run outside any HTTP request context, on a
schedule rather than in response to a client call. There's a single job as of
this writing:

- **`app/tasks/followup_reminders.py` — `send_activity_followup_reminders()`.**
  Notifies whoever a CRM Activity is assigned to (or its creator, if
  `assigned_to`'s free-text name doesn't match a real user) one day before and
  on the day of its `next_followup` date. Only `status: "Open"` activities are
  considered.

Wired up in `app/main.py`'s `startup` event via APScheduler's
`BackgroundScheduler`, on a daily `CronTrigger(hour=8, minute=0)` pinned to
`Asia/Kolkata` (so it fires at 8 AM IST regardless of the container's system
timezone). Shut down cleanly on the `shutdown` event.

Each job function is split into two: a scheduler entry point that opens its
own `SessionLocal()` (since there's no request to inject a `db` session from),
and a `_`-prefixed pure-logic function that takes an already-open `Session` —
the latter is what tests call directly, so they never touch the entry point's
production-bound `SessionLocal` (see the note in
[TESTING.md](../testing/TESTING.md#activity-follow-up-reminder-testing)).
Follow this split for any new scheduled job.

APScheduler runs in-process — this only works because the app runs as a single
instance (see Scaling Strategy below). Moving to multiple instances/workers
would need the job moved to a proper scheduler (or guarded so only one
instance runs it) to avoid duplicate sends.

## Deployment Architecture

```
┌─────────────────────────────────────┐
│   Docker Container                   │
│  ┌────────────────────────────────┐ │
│  │ FastAPI App (Uvicorn)          │ │
│  │ - 1 worker (see docker-        │ │
│  │   entrypoint.sh — matters for  │ │
│  │   the in-process scheduler,    │ │
│  │   above)                       │ │
│  │ - Port 8000 (internal)         │ │
│  └────────────────────────────────┘ │
└──────────────┬──────────────────────┘
               │
        ┌──────▼──────┐
        │   Nginx     │
        │ Port 80/443 │
        │  (reverse   │
        │   proxy)    │
        └──────┬──────┘
               │
        ┌──────▼──────────┐
        │  PostgreSQL     │
        │  (managed DB)   │
        └─────────────────┘
```

## Scaling Strategy

### Current (Monolith)
- Single FastAPI instance
- Suitable for ~1000 concurrent users

### Future (Microservices)
- Extract CRM, ERP, RnD as separate services
- Each service has own database
- API Gateway routes requests
- Services communicate via events (message queue)

Module structure supports this — minimal changes needed to extract a module into a separate service.

## Security

### Authentication
- Microsoft SSO only (no passwords stored locally)
- JWT tokens with 24-hour expiry
- HttpOnly cookies (frontend integration later)
- `users.hashed_password` / `users.must_change_password` exist in the table
  but are inert — no route or service reads or writes them. If a local-
  password login is ever added, hash with passlib/argon2 (add the dependency
  first — it's not currently in requirements.txt) and never store plaintext.

### Authorization
- Role-based access control (user, admin)
- Check role in service layer

### Database
- No direct user input in SQL (SQLAlchemy parameterized queries)
- SQL injection protection built-in

### Networking
- CORS configured for frontend domains
- HTTPS recommended in production
- API rate limiting (to implement)

## Error Handling

- **Validation errors** → 400 Bad Request (Pydantic)
- **Authentication errors** → 401 Unauthorized
- **Authorization errors** → 403 Forbidden
- **Not found** → 404 Not Found
- **Server errors** → 500 Internal Server Error (logged)

## Testing Strategy

### Unit Tests
- Test services in isolation
- Mock repositories
- Test business logic

### Integration Tests
- Test full flow (route → service → repository)
- Use in-memory SQLite database
- Test database constraints

### Example:
```python
def test_create_note_validates_title(service):
    with pytest.raises(ValueError):
        service.create_note(CreateNoteSchema(title="", description="..."))
```

## Monitoring & Logging (Future)

- Application logs → Cloud logging service
- Database query logging
- API request/response logging
- Performance metrics (response times, error rates)
- Alerts for critical errors

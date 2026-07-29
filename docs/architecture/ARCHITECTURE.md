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
        │  │  ├─ /auth/*          │   │
        │  │  ├─ /api/v1/crm/*    │   │
        │  │  ├─ /api/v1/erp/*    │   │
        │  │  └─ /api/v1/rnd/*    │   │
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

`app/tests/test_crm.py` and `app/tests/test_crm_documents.py` cover this module; see
[TESTING.md](../testing/TESTING.md) for how to run them.

## Authentication & Authorization

### Flow:
1. User goes to `/auth/microsoft-login`
2. Redirects to Microsoft login page
3. User authenticates with Microsoft account
4. Redirects back to `/auth/callback` with authorization code
5. App exchanges code for access token
6. App fetches user profile from Microsoft Graph API
7. App checks if user exists in DB:
   - **No** → Create new user (auto-provision)
   - **Yes** → Update user profile (sync with Azure)
8. App creates JWT token
9. Returns token to frontend

### Token Usage:
- Browser sessions: JWT delivered as an httponly `session_token` cookie by
  `/auth/callback` and the Teams SSO routes — never exposed to page JS
- API clients / tooling: `Authorization: Bearer <token>` header (same JWT, same
  `get_current_user` dependency — cookie is just checked first)
- Server verifies the token (or the cookie, or an `X-API-Key`) on every protected route
- Token expires after 24 hours

## Database Schema

### Main Tables
- `users` — Portal users, role, Azure profile

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

### RnD Tables (not yet created — module not ported)
`app/modules/rnd` is currently empty scaffolding; these tables exist in legacy
and will be created here once the calculation tools are ported (see
[API.md — RnD Endpoints](../api/API.md#rnd-endpoints)):
- `braking_calculations`, `hydraulic_calculations`, `load_distribution_calculations`,
  `qmax_calculations`, `spline_calculations`, `tractive_effort_calculations`,
  `vehicle_performance_calculations` — one table per tool, each storing that
  tool's specific input parameters + computed results
- `calculation_history` — cross-tool save/rename/list/delete log, one row per
  named save regardless of which tool produced it

## Deployment Architecture

```
┌─────────────────────────────────────┐
│   Docker Container                   │
│  ┌────────────────────────────────┐ │
│  │ FastAPI App (Uvicorn)          │ │
│  │ - 4 workers                    │ │
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

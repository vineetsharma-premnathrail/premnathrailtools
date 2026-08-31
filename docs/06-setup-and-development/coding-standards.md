# ERP-PremnathRail — Coding Standards

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Setup & Development
**Document:** Coding Standards
**Prepared by:** Vineet Sharma
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the coding conventions currently followed in the ERP-PremnathRail codebase.

The purpose is to keep new development consistent with the existing implementation across:

* Backend
* Frontend
* Database models
* API routes
* Authentication and authorization
* Audit logging
* Soft deletion
* Module organization

These are implementation standards based on the existing codebase, not aspirational rules.

---

# 2. Backend Coding Standards

**Technology:**

* FastAPI
* SQLAlchemy 2.0
* Pydantic v2
* Python

---

## 2.1 SQLAlchemy Models

All models use SQLAlchemy 2.0 typed declarative syntax.

Use:

```python
class Project(Base, TimestampMixin, SoftDeleteMixin):

    __tablename__ = "erp_projects"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    serial_number: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        index=True,
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(50),
        default="active",
        nullable=False,
    )

    po_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )
```

### Rules

* Always use `Mapped[...]`.
* Python type must match database nullability.
* Use `Mapped[str | None]` for nullable strings.
* Use shared mixins where applicable.
* Use module-prefixed table names where appropriate.
* Do not introduce legacy untyped `Column(...)` declarations for new models.

---

# 3. Shared Model Mixins

Common model behavior should use shared mixins.

## TimestampMixin

Provides:

```text
created_at
updated_at
```

## SoftDeleteMixin

Provides:

```text
is_deleted
deleted_at
```

Do not redeclare these fields unnecessarily inside individual models.

---

# 4. Pydantic Schemas

ERP-PremnathRail uses Pydantic v2.

Response schemas should support ORM object conversion using:

```python
model_config = {"from_attributes": True}
```

Example:

```python
class ProjectAttachmentResponse(BaseModel):

    model_config = {"from_attributes": True}

    id: int
    project_id: int
```

### Rules

Use separate schemas for:

```text
Create
Update
Response
```

Avoid creating one generic schema where every field is optional.

---

# 5. Module Structure

Two existing backend structures are currently used.

New development should follow the structure already established by the module being modified.

---

## 5.1 Flat Module Structure

Used by modules such as:

```text
erp
purchase
p2p
```

Typical structure:

```text
modules/<name>/
├── models/
├── schemas/
├── routes/
└── service.py
```

`service.py` is currently used by Purchase and P2P.

ERP currently contains business logic directly inside route handlers.

---

## 5.2 Layered Module Structure

Used by:

```text
crm
rnd
main
```

Typical structure:

```text
modules/<name>/
├── api/
├── models/
├── repositories/
├── routes/
├── schemas/
├── services/
└── tests/
```

CRM also contains:

```text
reports/
```

---

# 6. Service Module Scaffold

The following directory exists:

```text
backend/app/modules/service/
```

It currently acts as a scaffold.

Its internal directories are empty and it is not wired into `main.py`.

Therefore, new code should not automatically be placed there without first confirming that the module is intended to become active.

---

# 7. FastAPI Dependency Injection

Routes use FastAPI dependency injection.

Example:

```python
router = APIRouter(
    prefix="/erp/projects",
    tags=["ERP - Projects"],
)

@router.get(
    "",
    response_model=list[ProjectResponse],
)
async def list_projects(
    search: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(
        require_app_access("erp")
    ),
):
    ...
```

---

# 8. Database Dependency

Database sessions are provided through:

```python
Depends(get_db)
```

This provides a request-scoped SQLAlchemy `Session`.

Routes should obtain database access through dependency injection rather than creating unmanaged sessions.

---

# 9. Application Authorization Dependency

Module-level authorization uses:

```python
Depends(require_app_access("<module>"))
```

The dependency is defined in:

```text
backend/app/core/permissions.py
```

Conceptually:

```python
def require_app_access(app_name: str):

    def _dependency(
        user: User = Depends(get_current_user)
    ) -> User:

        if app_name not in user.get_apps():
            raise HTTPException(
                status_code=403,
                detail=f"Access to '{app_name}' module required",
            )

        return user

    return _dependency
```

Administrators pass module-level checks because their application access includes all modules.

---

# 10. Granular ERP Permissions

Fine-grained ERP authorization uses:

```python
has_erp_permission(user, permission)
```

Examples include:

```text
project_view
project_create
project_edit
project_delete

sr_view
sr_create
sr_edit
sr_delete
```

These checks should be performed server-side.

---

# 11. API Route Naming

Each module defines its own `APIRouter`.

Examples:

```text
/erp/projects
/purchase/requisitions
/p2p/requests
```

Routes are globally mounted under:

```text
/api/v1
```

R&D additionally uses:

```text
/api/v1/rnd
```

---

# 12. Route File Naming

Route files should normally use the plural resource name.

Examples:

```text
projects.py
service_requests.py
users.py
```

---

# 13. Python Naming Standards

Backend Python follows standard naming conventions.

### Functions and Variables

Use:

```text
snake_case
```

Example:

```python
get_current_user()
write_audit()
project_id
```

### Classes

Use:

```text
PascalCase
```

Example:

```python
Project
ServiceRequest
ProjectResponse
```

### Private Helpers

Prefix module-private helpers with:

```text
_
```

Example:

```python
_write_audit()
_dependency()
```

---

# 14. Soft Delete

Models using `SoftDeleteMixin` contain:

```text
is_deleted
deleted_at
```

Normal reads must exclude deleted records.

Example:

```python
query = db.query(Project).filter(
    Project.is_deleted == False
)  # noqa: E712
```

---

# 15. Soft Delete Cascading

Soft deletion of a parent does not automatically cascade through ORM relationships.

Dependent records must therefore be updated explicitly when required.

Example:

```python
project.is_deleted = True
project.deleted_at = now

for sr in db.query(ServiceRequest).filter(
    ServiceRequest.project_id == project.id,
    ServiceRequest.is_deleted == False,
).all():  # noqa: E712

    sr.is_deleted = True
    sr.deleted_at = now
```

---

# 16. `# noqa: E712`

The following pattern is intentional:

```python
Model.is_deleted == False
```

Use:

```text
# noqa: E712
```

where required.

SQLAlchemy column comparisons must use `==`, rather than Python's:

```python
is False
```

---

# 17. Audit Logging

Audit-worthy actions should use the shared:

```text
AuditLog
```

model.

Location:

```text
backend/app/modules/main/models/audit_log.py
```

Do not create separate audit tables for individual modules unless a specific architectural decision requires it.

---

# 18. Audit Record Structure

The shared audit model includes concepts such as:

```text
entity_type
entity_id
action
performed_by_id
summary
```

Example:

```python
AuditLog(
    entity_type="project",
    entity_id=project_id,
    action="updated",
    performed_by_id=user.id,
    summary=summary,
)
```

---

# 19. Audit Naming

Audit records should follow a consistent pattern.

### `entity_type`

Use a lowercase noun:

```text
project
service_request
inquiry
tender
```

### `action`

Use a concise verb:

```text
created
updated
deleted
restored
```

### `summary`

Use an optional human-readable description.

---

# 20. Frontend Coding Standards

**Technology:**

* Next.js 16
* React 19
* TypeScript

---

# 21. Dashboard Styling

The existing dashboard convention uses inline React style objects.

Example:

```tsx
import { BRAND, TEXT } from "@/lib/theme";

<h1
  style={{
    fontSize: 30,
    fontWeight: 800,
    color: TEXT.heading,
    margin: "0 0 6px",
  }}
>
```

---

# 22. Design Tokens

Frontend dashboard components should use tokens from:

```text
frontend/src/lib/theme.ts
```

Available token groups include:

```text
BRAND
TEXT
BG
BORDER
SUCCESS
DANGER
WARNING
INFO
PURPLE
GLASS
SHADOWS
GRADIENTS
```

Compatible aliases include:

```text
COLORS
RADII
BORDERS
```

---

# 23. Tailwind Usage

Tailwind is installed in the project.

However, dashboard pages currently do not use Tailwind utility classes.

Therefore, new dashboard components should not introduce Tailwind classes into existing dashboard pages because that would mix styling systems.

Tailwind should be treated as existing scaffolding unless an explicit decision changes the frontend styling convention.

---

# 24. React Naming

React components use PascalCase.

Examples:

```text
Sidebar.tsx
ProjectForm.tsx
```

---

# 25. Next.js Route Naming

Next.js App Router route folders use lowercase route segments.

Example:

```text
app/dashboard/erp/projects/[id]/edit/page.tsx
```

Dynamic route segments use the standard Next.js bracket convention.

---

# 26. Hooks

React hooks use:

```text
useX
```

Examples:

```text
useAuth
useRequireApp
useRequireErpPermission
```

---

# 27. Zustand Stores

Zustand stores use:

```text
useXStore
```

Example:

```text
useAuthStore
```

---

# 28. TypeScript Standards

Frontend application code should:

* Prefer explicit types for shared data structures.
* Reuse API response types where available.
* Avoid unnecessary `any`.
* Keep component props clearly defined.
* Follow existing project conventions before introducing new abstractions.

---

# 29. API Communication

Frontend components should communicate with backend APIs through the established API-client pattern.

The general flow is:

```text
React Component
      ↓
API Client
      ↓
Backend API
      ↓
FastAPI Route
```

Direct ad-hoc API calls should not be introduced when an existing shared client already provides the required operation.

---

# 30. Authorization in Frontend

Frontend authorization uses mechanisms such as:

```text
useRequireApp()
useRequireErpPermission()
```

These controls primarily manage:

* Page access
* Navigation
* User experience
* Conditional UI

They do not replace backend authorization.

The backend remains the authoritative security boundary.

---

# 31. Backend-First Security

Every sensitive operation must ultimately be protected on the backend.

Conceptually:

```text
Frontend Guard
      ↓
Backend Authentication
      ↓
Backend Authorization
      ↓
Business Logic
      ↓
Database
```

A hidden button is not considered a security control.

---

# 32. New Code Rule

When modifying an existing module:

1. Inspect the module's current structure.
2. Follow its established conventions.
3. Reuse existing utilities.
4. Avoid introducing a second pattern unnecessarily.
5. Keep the implementation consistent with adjacent code.

---

# 33. Refactoring Rule

Existing structural differences between modules should not automatically be normalized.

Refactoring should be performed when there is a concrete benefit such as:

* Maintainability
* Testability
* Complexity reduction
* Performance
* Security
* Clear architectural improvement

Directory symmetry alone is not sufficient justification.

---

# 34. Documentation Relationship

Coding standards support the technical documentation structure.

Related areas include:

```text
docs/01-architecture/
docs/02-modules/
docs/03-database/
```

Development configuration is documented through:

```text
configuration.md
environment-variables.md
development-setup.md
```

---

# 35. Code Review Expectations

Before merging significant code, verify:

* Existing module conventions are followed.
* Authentication is correctly applied.
* Authorization is enforced server-side.
* Database operations use the established ORM patterns.
* Request/response schemas are defined correctly.
* Soft-delete behavior is preserved where applicable.
* Audit logging is added for audit-worthy operations.
* Existing frontend design tokens are reused.
* Tests are updated where applicable.

---

# 36. Standards Update Rules

This document should be updated when an established coding convention changes across the project.

Examples:

* Python framework changes
* ORM conventions change
* Pydantic conventions change
* Frontend styling system changes
* Module architecture changes
* Authorization implementation changes
* Standard API structure changes
* New project-wide development conventions are adopted

Individual code changes do not require a standards-document revision.

---

# 37. Historical Versions

Previous approved versions should be retained.

Example:

```text
v1.0
Initial coding standards

v1.1
Minor convention updates

v1.2
Additional development standards

v2.0
Major technology or architecture change
```

The current version describes the active standard.

Historical versions preserve previous project conventions.

---

# 38. Related Documents

* Project Structure
* Development Setup
* Configuration
* Environment Variables
* Software Architecture
* HLD
* LLD
* Security Implementation Guide
* Permission Matrix
* Database Schema
* API Documentation
* Module Documentation

---

# 39. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 40. Document Information

**Document:** Coding Standards
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Setup & Development
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026

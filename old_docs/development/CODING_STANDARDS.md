# Coding Standards

Conventions actually observed in the codebase (backend `backend/app/`, frontend `frontend/src/`), not aspirational rules. See also [architecture](../architecture/) and [database](../database/) docs for system-level design.

## Backend (FastAPI / SQLAlchemy 2.0 / Pydantic v2)

### Models — typed `Mapped[...]` columns (SQLAlchemy 2.0 style)

Every model uses SQLAlchemy 2.0's typed declarative style, not the legacy `Column(...)` without types. Example, `backend/app/modules/erp/models/project.py`:

```python
class Project(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "erp_projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    serial_number: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="active", nullable=False)
    po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
```

Rules to follow:
- Always declare the Python type in `Mapped[...]`, matching nullability (`Mapped[str | None]` for `nullable=True`).
- Inherit shared behavior via mixins — `TimestampMixin` (created_at/updated_at) and `SoftDeleteMixin` (see below) rather than redeclaring those columns per model.
- `__tablename__` is prefixed by module where useful (e.g. `erp_projects`) to avoid name collisions across modules sharing one database.

### Schemas — Pydantic v2 with `from_attributes`

Response schemas read directly from ORM objects, so every response model declares:

```python
class ProjectAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    project_id: int
    ...
```

Rules:
- Use the dict-literal `model_config = {"from_attributes": True}` form (Pydantic v2), not the v1 `class Config`.
- Separate `*Create` / `*Update` / `*Response` schema classes per resource rather than one shared schema with optional fields — check `backend/app/modules/erp/schemas/project.py` and `backend/app/modules/p2p/schemas/p2p_request.py` for the pattern.

### Module layout

**Two layouts currently coexist in this codebase** — be aware of both when adding files, and prefer matching whichever layout the module you're editing already uses:

1. **Flat layout** (`erp`, and `purchase`/`p2p` with an added `service.py`):
   ```
   modules/<name>/models/*.py
   modules/<name>/schemas/*.py
   modules/<name>/routes/*.py
   modules/<name>/service.py        # purchase, p2p only — plain-function helpers
   ```
   `erp` has no `service.py` — business logic lives directly in the route handlers.

2. **Layered layout** (`crm`, `rnd`, `main`):
   ```
   modules/<name>/api/
   modules/<name>/models/
   modules/<name>/repositories/
   modules/<name>/routes/
   modules/<name>/schemas/
   modules/<name>/services/
   modules/<name>/tests/
   ```
   `crm` additionally has `reports/`.

`backend/app/modules/service/` exists as a scaffold with the layered directories (`api/`, `models/`, `repositories/`, `schemas/`, `services/`, `tests/`) but **every directory is empty** — it is not wired into `main.py` and is not a real module. Do not add code there without first confirming with the team whether it's meant to be resurrected or deleted.

See [MODULE_DOCUMENTATION.md](./MODULE_DOCUMENTATION.md) for what belongs in each module.

### FastAPI dependency injection

Standard per-route dependencies, e.g. `backend/app/modules/erp/routes/projects.py`:

```python
router = APIRouter(prefix="/erp/projects", tags=["ERP - Projects"])

@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    search: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("erp")),
):
    ...
```

- `Depends(get_db)` for a request-scoped SQLAlchemy `Session`.
- `Depends(require_app_access("<module>"))` — a dependency **factory** defined in `backend/app/core/permissions.py`:

  ```python
  def require_app_access(app_name: str):
      def _dependency(user: User = Depends(get_current_user)) -> User:
          if app_name not in user.get_apps():
              raise HTTPException(status_code=403, detail=f"Access to '{app_name}' module required")
          return user
      return _dependency
  ```
  Admins pass every check because `user.get_apps()` returns all modules for admins. The same file also defines `has_erp_permission(user, permission)` for finer-grained checks inside ERP routes.
- `APIRouter(prefix=...)` is declared per-module (e.g. `/erp/projects`, `/purchase/requisitions`, `/p2p/requests`) and mounted globally under `/api/v1` in `backend/app/main.py` (RnD additionally gets `/api/v1/rnd`).

### Soft delete

ERP entities use `SoftDeleteMixin`, giving every model `is_deleted: bool` and `deleted_at: datetime | None`. Always filter reads:

```python
query = db.query(Project).filter(Project.is_deleted == False)  # noqa: E712
```

and cascade soft-deletes to dependents manually (there's no ORM cascade for this):

```python
project.is_deleted = True
project.deleted_at = now
for sr in db.query(ServiceRequest).filter(ServiceRequest.project_id == project.id, ServiceRequest.is_deleted == False).all():  # noqa: E712
    sr.is_deleted = True
    sr.deleted_at = now
```

The `# noqa: E712` on `== False` comparisons is intentional and required — SQLAlchemy column comparisons don't work with `is False`.

### Audit logging

Use the shared, polymorphic `AuditLog` model (`backend/app/modules/main/models/audit_log.py`) rather than a per-module audit table:

```python
class AuditLog(Base):
    __tablename__ = "audit_logs"
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    ...
```

Write via a small module-local helper, e.g. `backend/app/modules/erp/routes/projects.py`:

```python
def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None):
    db.add(AuditLog(entity_type="project", entity_id=project_id, action=action, performed_by_id=user.id, summary=summary))
```

Follow this `entity_type` (lowercase noun) + `action` (verb) + `summary` convention for new audit writes rather than inventing a new shape.

## Frontend (Next.js 16 / React 19 / TypeScript)

### No CSS-in-JS library, no Tailwind classes in dashboard pages

Tailwind **is** installed (`frontend/tailwind.config.js`, `tailwindcss`/`@tailwindcss/postcss` in `frontend/package.json`), but dashboard pages do not use Tailwind utility classes. The established convention is inline `style={{...}}` objects referencing design tokens from `frontend/src/lib/theme.ts`:

```tsx
import { BRAND, TEXT } from '@/lib/theme'

<h1 style={{ fontSize: 30, fontWeight: 800, color: TEXT.heading, margin: '0 0 6px' }}>
<p style={{ fontSize: 14, color: TEXT.muted, margin: '0 0 36px' }}>{today}</p>
```

When adding new dashboard UI, match this pattern: import tokens (`BRAND`, `TEXT`, `BG`, `BORDER`, `SUCCESS`/`DANGER`/`WARNING`/`INFO`/`PURPLE`, `GLASS`, `SHADOWS`, `GRADIENTS`, or the back-compat aliases `COLORS`/`RADII`/`BORDERS`) from `theme.ts` and pass them into `style={{}}`. Do not introduce Tailwind classes into existing dashboard components — it would mix two styling systems. If Tailwind's presence in `package.json` is unused elsewhere in the app, treat it as leftover scaffolding rather than the active convention.

### Naming conventions observed

- React page/component files: PascalCase for components (`Sidebar.tsx`, `ProjectForm.tsx`), lowercase route-segment folders per Next.js App Router convention (`app/dashboard/erp/projects/[id]/edit/page.tsx`).
- Hooks: `useX` naming (`frontend/src/hooks/useAuth.ts`).
- Zustand stores: `useXStore` (`frontend/src/store/authStore.ts` exports `useAuthStore`).
- Backend Python: snake_case for functions/variables, PascalCase for SQLAlchemy models and Pydantic schemas, module-private helpers prefixed with `_` (e.g. `_write_audit`, `_dependency`).
- Route files are named after the resource in plural (`projects.py`, `service_requests.py`, `users.py`).

## Cross-references

- Directory layout details: [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md)
- Per-module business rules: [MODULE_DOCUMENTATION.md](./MODULE_DOCUMENTATION.md)
- Config/env var reference: [CONFIGURATION.md](./CONFIGURATION.md), [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md)
- Error/exception conventions: [ERROR_HANDLING.md](./ERROR_HANDLING.md)
- Local setup: [DEVELOPMENT_SETUP.md](./DEVELOPMENT_SETUP.md)

# Module Documentation

Covers every subpackage under `backend/app/modules/`. For layout conventions and coding patterns referenced here, see [CODING_STANDARDS.md](./CODING_STANDARDS.md); for the overall tree, see [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md). Database-level schema detail lives in [../database/](../database/).

## erp — `backend/app/modules/erp/`

**Layout:** flat (`models/`, `routes/`, `schemas/`, no `service.py`).

**Models** (`models/`): `project.py`, `project_attachment.py`, `service_request.py`, `service_request_attachment.py`, `service_material.py`, `service_material_attachment.py`.

**Routes**: `projects.py` (prefix `/erp/projects`), `service_requests.py` (prefix `/erp/service-requests`). Both mount under the global `/api/v1` prefix from `main.py`.

**Key invariants:**
- **Soft delete everywhere.** Every ERP entity inherits `SoftDeleteMixin` (`is_deleted: bool`, `deleted_at: datetime | None`). All list/detail queries must filter `Project.is_deleted == False` (see `backend/app/modules/erp/routes/projects.py`). Deleting a `Project` cascades a soft-delete to its `ServiceRequest`s manually in Python — there is no DB-level cascade.
- **Audit trail via shared `AuditLog`.** ERP routes write to the polymorphic `AuditLog` model (defined in `main`, see below) rather than a module-local audit table, tagging `entity_type="project"` / `"service_request"` etc.
- Access is gated per-request with `Depends(require_app_access("erp"))`; some routes additionally check `has_erp_permission(user, permission)` for finer-grained action-level permissions (both defined in `backend/app/core/permissions.py`).

## purchase — `backend/app/modules/purchase/`

**Layout:** flat + top-level `service.py`, plus `reports/`.

**Models**: `p2p.py`, `purchase_requisition_item.py`.

**Routes**: `purchase_requisitions.py` (prefix `/purchase/requisitions`).

**Key invariant:** this module's purchase requisitions are **only** ones generated out of an ERP Service Request's Materials tab — i.e. a PR here always traces back to a specific service request's material line items. It is not a general-purpose requisition system; see `p2p` below for that.

## p2p — `backend/app/modules/p2p/`

**Layout:** flat (`models/`, `routes/`, `schemas/`) + top-level `service.py`.

**Models**: `p2p_request.py`, `p2p_request_item.py`, `p2p_request_attachment.py`.

**Routes**: `p2p_requests.py` (prefix `/p2p/requests`).

**Key invariant — independence from `purchase`.** This is a deliberately separate, standalone PR workflow that any department can raise directly, not tied to an ERP Service Request. Quoted from the source:

- `backend/app/modules/p2p/service.py`:
  > "Plain-function helpers for the standalone Purchase Requisition module — PR number generation, kept separate from routes so it's easy to unit test."
- `backend/app/modules/p2p/models/p2p_request.py`:
  > "Lifecycle of a standalone Purchase Requisition (PR) raised directly by any department (distinct from app.modules.purchase, which only handles PRs raised out of a Service Request's Materials tab)."
  > "A standalone purchase requisition raised by any department, tracked and processed end-to-end by the Purchase team. Fully independent of the [purchase module]..."

**Do not conflate the two modules** — `purchase` = ERP-Service-Request-derived PRs; `p2p` = general standalone departmental PRs. They have separate models, separate route prefixes, and separate PR numbering via their own `service.py`.

## main — `backend/app/modules/main/`

**Layout:** layered (`api/`, `models/`, `repositories/`, `routes/`, `schemas/`, `services/`, `tests/`).

**Models**: `api_key.py`, `audit_log.py`, `feedback.py`, `notification.py`, `user.py`.

**Routes**: `api_keys.py` (`/api-keys`), `auth.py` (`/auth`), `feedback.py` (`/feedback`), `notifications.py` (`/notifications`), `presence.py` (`/presence`), `users.py` (`/users`).

**Key invariant — this module owns the shared, polymorphic audit log used by every other module.** `AuditLog` (`backend/app/modules/main/models/audit_log.py`) is a generic entity-agnostic table:

```python
class AuditLog(Base):
    __tablename__ = "audit_logs"
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    field_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    performed_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
```

Other modules (`erp`, and likely others as they add audit trails) write rows into this same table via `entity_type`/`entity_id` rather than defining their own audit models. `main` also owns user identity/roles (`user.py` — `get_apps()` used by `require_app_access`), API-key auth records consumed by `backend/app/middleware/api_key.py`, and app-wide notifications/feedback.

## crm — `backend/app/modules/crm/`

**Layout:** layered (`api/`, `models/`, `reports/`, `repositories/`, `routes/`, `schemas/`, `services/`, `tests/`) — the most fully layered module in the codebase, with an explicit repository/service split (unlike `erp`, which puts logic straight in routes).

**Models**: `activity.py`, `activity_attachment.py`, `discussion.py`, `document.py`, `inquiry.py`, `note.py`, `organization.py`, `purchase_order.py`, `stage_log.py`, `tender.py`.

**Routes**: `activities.py` (`/crm/activities`), `bulk_import.py` (`/crm/admin/import`), `dashboard.py` (`/crm/dashboard`), `documents.py` (`/crm/documents`), `inquiries.py` (`/crm/inquiries`), `notes.py` (`/crm/notes`), `organizations.py` (`/crm/organizations`), `tenders.py` (`/crm/tenders`), `workflow.py` (`/crm`).

**Key invariant:** CRM tracks inquiry → tender → purchase-order pipeline state with an explicit `stage_log.py` model, i.e. stage transitions are themselves recorded as rows (a domain-specific parallel to the generic `AuditLog`), not just as a mutable status field. `workflow.py` centralizes the stage-transition rules rather than letting each route mutate stage state independently.

## rnd — `backend/app/modules/rnd/`

**Layout:** layered (`api/`, `models/`, `repositories/`, `routes/`, `schemas/`, `services/`, `tests/`, `tools/`).

**Models**: `calculation_history.py`, `tool_calculations.py`.

**Routes**: `calculations.py`, `history.py` (both mounted, via `main.py`, under the extra prefix `/api/v1/rnd` rather than the plain `/api/v1` every other module gets).

**Key invariant:** RnD is an engineering-calculation-tool module (a `tools/` directory holds the calculation logic itself, separate from `services/` which likely orchestrates persistence/history). Every calculation run is persisted to `calculation_history.py`, so results are auditable/reproducible rather than stateless request/response only.

## service — `backend/app/modules/service/`

Contains the full layered scaffold directory set (`api/`, `models/`, `repositories/`, `schemas/`, `services/`, `tests/`) but **every one of those directories is empty** — zero files. It is **not imported anywhere in `backend/app/main.py`** and has no `routes/` directory at all, so it cannot currently serve any HTTP traffic. Treat this as dead/unused scaffolding, not a real module — do not assume it implements anything related to ERP's "Service Requests" feature (that functionality lives in `erp/models/service_request.py` and `erp/routes/service_requests.py`, a completely different thing despite the similar name). Flag this to the team before building on it or removing it.

## Cross-references

- [../architecture/](../architecture/) for how these modules fit into the overall system
- [../database/](../database/) for full schema/table definitions
- [CODING_STANDARDS.md](./CODING_STANDARDS.md) for the two coexisting module layouts

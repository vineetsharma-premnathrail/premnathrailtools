---
name: premnathrail-app-design
description: Structural conventions for the Premnathrail Portal (Next.js + FastAPI modular monolith) — how modules, routes, schemas, migrations, and API clients are organized. Load before adding a new module, a new page/route, a new backend endpoint, a new Alembic migration, or a new entry in the frontend API client/types, so the addition matches existing structure instead of inventing a new pattern.
---

# Premnathrail Portal — Structure Patterns

This app is a modular monolith: `frontend/` (Next.js App Router) + `backend/` (FastAPI + SQLAlchemy + Alembic), organized around business modules (erp, crm, purchase, p2p, rnd, main/users).

## Frontend routing layout

Under `frontend/src/app/dashboard/<module>/`:
- `page.tsx` — list/landing page for the module.
- `new/page.tsx` — create form.
- `[id]/page.tsx` — detail view. `[id]/edit/page.tsx` when edit is a separate page from view (e.g. `erp/projects/[id]/edit/`, `crm/organizations/[id]/edit/`).
- Distinct workflow stages get their own top-level sibling folder under the module rather than a query param, e.g. `p2p/{approval,rfq,po-approval,grn,payment}/`, `purchase/{grn,invoices,orders,rfqs,vendors}/`.

**Sub-nav tabs**: modules with multiple pages get a hand-rolled nav component, e.g. `frontend/src/components/erp/ErpNav.tsx`, `frontend/src/components/p2p/P2PNav.tsx`. Each is `'use client'`, defines a local `TABS` array of `{ href, label, icon }`, an inline `TabIcon` SVG switch, uses `usePathname()` for active-tab detection (exact match for the module root, `startsWith` for sub-routes), and renders a flex row of `<Link>`s with a 2px bottom border on the active tab, plus a `NotificationBell` (`frontend/src/components/erp/NotificationBell.tsx`) docked at the right end of the row (`<div style={{ paddingBottom: 8, flex: 'none' }}><NotificationBell /></div>`, tabs wrapped in a `flex: '1 1 auto', minWidth: 0` sibling div) — every module's tab bar carries this bell, not just ERP/CRM. There is **no shared generic `ModuleNav` component** — each module copies and adapts its own `<Module>Nav.tsx`; only the `TABS` array and accent color change. Follow this same copy-and-adapt approach for a new module's nav rather than trying to generalize it.

**Nav-then-header ordering**: on every page, the module's `<Module>Nav />` renders **first**, before the page's title/subtitle/action-button header block (and before any "← Back" link). This is a strict rule across ERP, CRM, R&D, and P2P — the tab row is always the topmost element in the returned JSX, never sandwiched after the header. Double-check this order whenever adding or editing a page in a tabbed module.

## Backend module layout

`backend/app/modules/<module>/` always has `models/`, `routes/`, `schemas/` sub-packages. Two tiers exist:
- **Simple modules** (p2p, erp): one models file per entity, one routes file, one schemas file per entity/router, plus a top-level `service.py` only if the module needs generated-number logic (e.g. PR numbers) — erp has no `service.py` since it has no such logic.
- **Mature modules** (crm, rnd, main, purchase): additionally split into `services/` (plural, class-based business logic) and `repositories/` (data access), and purchase has one routes/schemas file **per sub-resource** (`rfqs.py`, `vendors.py`, `goods_receipts.py`, `purchase_orders.py`, `purchase_invoices.py`, `documents.py`, `dashboard.py`) plus a `reports/` package for PDF generation.

Pick the tier that matches the module's complexity — don't force a small module into services/repositories, and don't cram a large module into one routes file.

## Pydantic schema convention

One file per entity under `schemas/`, always in this order:
1. `<X>AttachmentResponse` — nested attachment DTO, if any.
2. `<X>ItemPayload` / `<X>ItemResponse` — nested line-item DTOs, if any.
3. `<X>Create` — top-level create payload.
4. `<X>Update` — all-optional partial-update payload.
5. Action-specific payloads named `<X><Verb>Payload` (e.g. `P2PRequestActionPayload`, `P2PRequestAssignBuyerPayload`, `P2PRequestCreatePOPayload`).
6. `<X>Response` — full read/output DTO, always `model_config = {"from_attributes": True}`, with denormalized display fields (names resolved from ids) appended at the bottom.

Class names are always prefixed with the same PascalCase entity name as the SQLAlchemy model.

## Route registration (`backend/app/main.py`)

- Every route module is imported explicitly and aliased — no auto-discovery: `from app.modules.p2p.routes import p2p_requests as p2p_requests_routes`.
- All routers register with `app.include_router(<alias>.router, prefix="/api/v1")` — the module-specific path prefix (e.g. `/p2p/requests`) lives inside the router itself: `router = APIRouter(prefix="/p2p/requests", tags=["P2P"])`.
- All SQLAlchemy models are imported at the top of `main.py` even when unused directly, purely so Alembic sees them for autogenerate/metadata — the schema itself is Alembic-managed; `create_all()` is not used.

## Permission wiring

Backend — `AVAILABLE_APPS` set in `backend/app/modules/main/models/user.py`, and a route dependency in `backend/app/core/permissions.py`:
```python
def require_app_access(app_name: str):
    def _dependency(user: User = Depends(get_current_user)) -> User:
        if app_name not in user.get_apps():
            raise HTTPException(status_code=403, detail=f"Access to '{app_name}' module required")
        return user
    return _dependency
```
Use it either per-route — `Depends(require_app_access("erp"))` — or once at router level for a whole module: `router = APIRouter(dependencies=[Depends(require_app_access("rnd"))])`. A single router CAN mix access levels per-endpoint (p2p does: requester routes need `"p2p"`, buyer-only actions need `"purchase"`) — gate per-endpoint when a module serves two audiences, don't force one blanket permission.

Frontend — `useRequireApp(appName)` in `frontend/src/hooks/useAuth.ts` returns `{ user, isLoading, isAuthorized }`; see [[premnathrail-ui-behavior]] for the exact page-level idiom.

## Alembic migrations

Filename: `<hex_revision_id>_<snake_case_description>.py` in `backend/alembic/versions/`. Standard header (`revision`, `down_revision`, `branch_labels = None`, `depends_on = None`) forming a **strict linear chain** — always check `alembic heads` for the current head before writing `down_revision`, never branch. Because this schema evolved from a pre-existing production database, migrations defensively check for existing columns before adding them rather than assuming a clean autogenerate diff:
```python
inspector = sa.inspect(op.get_bind())
columns = {c["name"] for c in inspector.get_columns("purchase_requisitions")}
if "category_code" not in columns:
    op.add_column("purchase_requisitions", sa.Column("category_code", sa.String(length=10), nullable=True))
```
Use `op.batch_alter_table(...)` for column add/drop/rename on existing tables (used for the p2p item-column restructure) so SQLite compatibility isn't broken and multi-column edits stay atomic. Never drop/recreate a table to "rename" it — use `op.rename_table` / `alter_column` to preserve data, and always write a working `downgrade()`.

## Frontend API client (`frontend/src/lib/api.ts`)

One flat object per module, named `<module>Api` (`p2pApi`, `erpApi`, `purchaseApi`, `crmApi`, `rndApi`), each method an async arrow function calling the shared `apiClient` axios instance and returning `data`:
```ts
export const p2pApi = {
  list: async (params: Record<string, unknown> = {}) => {
    const { data } = await apiClient.get('/p2p/requests', { params })
    return data
  },
  get: async (id: number) => { const { data } = await apiClient.get(`/p2p/requests/${id}`); return data },
  create: async (payload: Record<string, unknown>) => { const { data } = await apiClient.post('/p2p/requests', payload); return data },
  // ...
}
```
Payloads are typically loosely typed as `Record<string, unknown>` rather than the strict `types/index.ts` interfaces — an existing inconsistency, not something to "fix" incidentally while doing unrelated work.

## Shared theme tokens (`frontend/src/lib/theme.ts`)

Exports `BRAND`, `TEXT`, `BG`, `BORDER`, `SUCCESS`/`DANGER`/`WARNING`/`INFO`/`PURPLE`, `GLASS`, `SHADOWS` (`SHADOWS.glass(hover?)` returns a layered glassmorphism box-shadow string), `GRADIENTS`. Every new form/list page re-declares its own local `inputStyle` / `labelStyle` / `sectionStyle` consts at module scope built from these tokens, rather than importing a shared version — this duplication is the established idiom, not an oversight:
```ts
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${BORDER.normal}`,
  background: 'rgba(255,255,255,.7)', fontSize: 13.5, outline: 'none', color: TEXT.body,
}
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: TEXT.secondary, marginBottom: 6, display: 'block' }
const sectionStyle: React.CSSProperties = {
  borderRadius: 18, background: GLASS.card, backdropFilter: GLASS.blur, WebkitBackdropFilter: GLASS.blur,
  border: `1px solid ${GLASS.border}`, boxShadow: SHADOWS.glass(), padding: 20, marginBottom: 20,
}
```

## `frontend/src/types/index.ts` organization

One `export interface <Entity>` per domain object, grouped roughly by module top-to-bottom. Nested/child records get `<Entity><Sub>` names (`P2PRequestAttachment`, `P2PRequestLineItem`). Create-payload variants are named `<Entity>Input` (`P2PRequestLineItemInput` mirrors `P2PRequestLineItem` minus `id`/`attachments`). Detail-page-only extensions use `<Entity>Detail extends <Entity>`. Metadata/lookup lists get an `<X>Meta` suffix (`PRCategoryMeta`).

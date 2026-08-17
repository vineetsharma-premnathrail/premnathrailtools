# Permission Matrix

Concrete, code-derived record of who can reach what. Built by grepping actual
gate call sites (`require_app_access`, `has_erp_permission`, `useRequireApp`,
`useRequireErpPermission`) — nothing here is aspirational. If a cell says a
route/page is gated, it is; if this document doesn't mention a gate, none
was found in the code at time of writing.

## 1. Module access model

Every user has a `role` (`admin` | ordinary staff role) and an
`assigned_apps` list. `User.get_apps()`
(`backend/app/modules/main/models/user.py`) computes the effective module
list:

- `role == "admin"` → **every** module in `AVAILABLE_APPS`, unconditionally.
- anyone else → exactly `assigned_apps` (empty list = no ERP/CRM/etc. access
  at all, even though they can still log in).

```
AVAILABLE_APPS = {"erp", "rnd", "crm", "purchase", "p2p"}
```

Backend gate: `require_app_access(app_name)` in `backend/app/core/permissions.py`
is a FastAPI dependency factory — `Depends(require_app_access("erp"))` 403s
any user whose `get_apps()` doesn't contain `"erp"`. There is no separate
"view" vs "manage" distinction at this layer: it's binary module access.

## 2. Module → route coverage (backend)

Grep of every `require_app_access(...)` call site:

| Module | Routes gated | Files |
|---|---|---|
| `erp` | All of Projects and Service Requests CRUD, attachments, notifications, `/test_email` | `backend/app/modules/erp/routes/projects.py`, `backend/app/modules/erp/routes/service_requests.py` |
| `crm` | All of Activities, Dashboard, Documents, Inquiries, Notes, Organizations, Tenders, and the workflow sub-resources (tasks, approvals, quotations, purchase orders, competitors, discussions) | `backend/app/modules/crm/routes/{activities,dashboard,documents,inquiries,notes,organizations,tenders,workflow}.py` |
| `purchase` | Purchase Requisition (legacy PR/quotation flow) CRUD | `backend/app/modules/purchase/routes/purchase_requisitions.py` |
| `p2p` | Only the top-level `list/create` on the newer P2P-Requests flow (`p2p_requests.py:101`) | `backend/app/modules/p2p/routes/p2p_requests.py` |
| `rnd` | Entire `calculations` router, gated once at router level (`APIRouter(dependencies=[Depends(require_app_access("rnd"))])`) rather than per-route | `backend/app/modules/rnd/routes/calculations.py` |

**Gap worth flagging:** in `backend/app/modules/p2p/routes/p2p_requests.py`, most routes (lines 242, 272, 303, 358, 390, 411, 430, 465, 502) actually gate on `require_app_access("purchase")`, not `"p2p"` — only the first route (line 101) checks the `p2p` app. This means a user assigned only the `p2p` app (and not `purchase`) can list/create P2P Requests but will be 403'd on most sub-actions (approve, comment, attach, etc.) unless they also hold the `purchase` app. Whether this is intentional (the two modules share underlying logic) or a bug is unclear from the code alone — flagged for a human to confirm intent.

## 3. Granular ERP sub-permissions

Only the `erp` module has a second, finer-grained permission layer. CRM,
R&D, and both purchase modules are all-or-nothing at the module-access level
above — there is no per-action breakdown for them in the current code.

`VALID_ERP_PERMISSIONS` (`backend/app/modules/main/routes/users.py`):

```
project_view, project_create, project_edit, project_delete,
sr_view,      sr_create,      sr_edit,      sr_delete
```

These live in `User.erp_permissions` (JSON list column) and are checked with
`has_erp_permission(user, permission)` (`backend/app/core/permissions.py`):
admins always pass; everyone else needs the permission string in their list.

| Permission | Enforced at | Note |
|---|---|---|
| `project_create` | `erp/routes/projects.py:96` | |
| `project_edit` | `erp/routes/projects.py:139, 376` | |
| `project_delete` | `erp/routes/projects.py:172, 467` | |
| `project_view` | *(defined, not referenced by `has_erp_permission` anywhere)* | Module-level `require_app_access("erp")` already gates read access; this permission id exists in the valid set / admin UI but has no separate backend check. |
| `sr_create` | `erp/routes/service_requests.py:214` | |
| `sr_edit` | `erp/routes/service_requests.py:163` | Combined with an ownership check: `sr.created_by_id == user.id and has_erp_permission(user, "sr_edit")` — i.e. this permission only lets you edit *your own* SRs, not everyone's. |
| `sr_delete` | `erp/routes/service_requests.py:170` | Same ownership-AND pattern as `sr_edit`. |
| `sr_view` | *(defined, not referenced)* | Same situation as `project_view`. |

**Gap:** `project_view` and `sr_view` are valid, assignable permission ids
(surfaced in the admin "Module Access" UI) that no backend route actually
checks — they're effectively cosmetic today. Read access is already implied
by holding the `erp` app itself.

## 4. Frontend route guards

`useRequireApp(appName)` and `useRequireErpPermission(permission, fallback)`
(`frontend/src/hooks/useAuth.ts`) are client-side redirect guards — they hide
pages from the nav and bounce disallowed users, but are **not** a security
boundary by themselves (the backend gates above are); they exist so an
unauthorized user doesn't see a broken/empty page.

### `useRequireApp` call sites, by module

| App | Pages |
|---|---|
| `crm` | `dashboard/crm/**` — activities (list/new/edit), inquiries (list/new/detail), notes (list/new/edit), organizations (list/new/edit/detail), tenders (list/new/detail), recycle-bin, and the CRM home page |
| `erp` | `dashboard/erp/**` — home, projects (list/detail), service-requests (list/detail/edit), recycle-bin, reports |
| `purchase` | `dashboard/purchase/**` (home, detail) and `dashboard/purchase/p2p-requests/**` (list/detail) — see note below |
| `p2p` | `dashboard/p2p/**` (new/list/detail) — see note below |
| `rnd` | `dashboard/rnd/**` — home, braking, history, hydraulic, load-distribution, qmax, spline, tractive-effort, vehicle-performance |

**Note on the purchase/p2p split:** pages under
`dashboard/p2p/**` guard on the `p2p` app, while pages
under `dashboard/purchase/p2p-requests/**` guard on `purchase`.
Combined with the backend gap in section 2, the `purchase` vs
`p2p` app boundary is inconsistent across the codebase and
should be reviewed/clarified by a human familiar with the intended product
split between the legacy Purchase Requisition flow and the newer P2P Requests
flow.

### `useRequireErpPermission` call sites

| Permission | Page | Fallback |
|---|---|---|
| (project create/edit permission) | `dashboard/erp/projects/new/page.tsx` | default `/dashboard/erp` |
| (project edit permission) | `dashboard/erp/projects/[id]/edit/page.tsx` | default `/dashboard/erp` |
| (SR create permission) | `dashboard/erp/service-requests/new/page.tsx` | default `/dashboard/erp` |

Only these three pages use the granular ERP permission hook; every other
project/SR page (list, detail, recycle-bin) relies on module-level
`useRequireApp("erp")` only, with any finer-grained edit/delete buttons
presumably conditionally rendered in-component (not verified here — would
need a per-component read to confirm each list/detail page hides its own
edit/delete controls consistently with the backend's `has_erp_permission`
checks).

## 5. Admin-only backend routes

`require_admin` (`backend/app/modules/main/routes/users.py`) is a separate,
stricter dependency (`user.role != "admin"` → 403) used for user management
endpoints (list/create/update users, assign apps/permissions) — distinct
from `require_app_access`, since there is no "admin" entry in
`AVAILABLE_APPS`; admin-ness is a `role` value, not a module grant.

## 6. API-key auth and this matrix

The `pew_...` API-key path (see [SECURITY.md](./SECURITY.md#api-key-authentication))
produces a synthetic `User(role="api_service")` scoped to `allowed_apps`, so
it flows through the exact same `require_app_access` / `has_erp_permission`
checks above. `get_api_key_record` is only called from one place in the
source, `backend/app/modules/main/routes/auth.py:117` inside
`get_current_user` — i.e. it's wired into the single shared auth-resolution
path, not a parallel/duplicate mechanism, and every route protected by
`require_app_access` is reachable via an API key scoped to that app.
`backend/app/tests/test_security_middleware.py` does exercise it
end-to-end (`test_api_key_authenticates_like_a_user`,
`test_inactive_api_key_is_rejected`, `test_api_key_scoped_to_allowed_apps_only`),
so this path is tested, not merely defined. What's unverified here is
whether any *external* integration actually uses it today, as opposed to
it being available-but-currently-unused by any real client.

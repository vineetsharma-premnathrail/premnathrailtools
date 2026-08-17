# Product Overview

## Premnathrail Portal

Internal business portal for Premnathrail (railway equipment company), unifying five live modules:
- **CRM** — organizations, inquiries, tenders, quotations, activities, MOM export (`backend/app/modules/crm/`)
- **ERP (Service Module)** — machine/project registry and field service request lifecycle (`backend/app/modules/erp/`)
- **R&D** — railway engineering calculators with PDF/DOCX report generation (`backend/app/modules/rnd/`)
- **Purchase** — Purchase Requisitions raised from a Service Request's materials list (`backend/app/modules/purchase/`)
- **Purchase Requisition (standalone)** — a newer, separate PR module any department can use directly, independent of Service Requests (`backend/app/modules/p2p/`)

Plus a `main` module underpinning all of the above: Microsoft SSO auth, user/role/permission management, audit log, notifications, feedback, API keys.

This document supersedes an earlier draft that described the product as an early-stage build (plain HTML/JS frontend, "Phase 1" auth). That is no longer accurate — see the README fixes and the feature list below for the real state.

## Vision

"A single, integrated internal platform where Premnathrail employees manage customer relationships, field service and machine records, purchasing, and engineering calculations — replacing scattered spreadsheets and email threads with one system of record, without duplicating what SAP, ADP, or SharePoint already do well."

## Scope

**In scope (built and live):**
- CRM: organization/contact management, inquiry → tender → quotation → customer PO pipeline, cross-department task assignment, approvals, competitor tracking, activities with photos, Minutes of Meeting export (Word/PDF), bulk import, recycle bin.
- ERP: machine/project registry with full lifecycle dates (warranty, AMC, commissioning), Service Request ticketing with materials tracking and SharePoint attachments, recycle bin, audit trail.
- R&D: 7 engineering calculators (braking, hydraulic, load distribution, qmax, spline, tractive effort, vehicle performance) with calculation history and PDF/DOCX report export.
- Purchase: PR lifecycle raised from a Service Request's material list through to closure.
- Purchase Requisition (standalone): a fuller PR lifecycle (buyer assignment → RFQ → vendor selection → PO → receipt tracking → close) usable by any department, not tied to a Service Request.
- Admin: user directory, per-module access (`assigned_apps`), granular ERP sub-permissions, audit log, notifications, feedback inbox, API keys.

**Explicitly out of scope (per original doc, still current unless a stakeholder says otherwise — see the flag in `DEPARTMENT_MODULES_ROADMAP.md`):**
- ❌ Accounting/finance module (system of record is SAP)
- ❌ HR module (system of record is ADP)
- ❌ Email client (use Outlook)
- ❌ Document management (use SharePoint) — the portal only stores attachment *references* to SharePoint, never re-implements it

**Planned but not yet built** (see `DEPARTMENT_MODULES_ROADMAP.md`, `PURCHASE_MODULE_PLAN.md`, `DESIGN_MODULE_PLAN.md`, `ELECTRICAL_MODULE_PLAN.md`): Design, Electrical, Fluids, Production, Store, Quality, Maintenance, Operations, Project Management, Vendor Development departments; vendor master, formal POs, costing, GRN, invoice tracking, and reporting dashboards for the SR-linked Purchase module (the standalone Purchase Requisition module already has several of these — see Roadmap below).

## Business Requirements

1. Every field service issue against a client machine must be trackable end-to-end (open → resolved → billed) with an audit trail.
2. Every material requested for a service job must be requisitioned, approved, and tracked through receipt.
3. Sales/BD must be able to track an inquiry from first contact through tender, quotation, and customer PO without leaving the portal.
4. Engineers must be able to run standard railway calculations and produce a client-ready PDF/DOCX report without manual spreadsheet work.
5. Access must be controllable per module and, for ERP, per sub-action (view/create/edit/delete on Projects and Service Requests separately).
6. All destructive actions (delete) must be soft-deletes with a recycle bin and restore path, not permanent.
7. Authentication must be via company Microsoft accounts (SSO) — no separate password system.

## User Roles

Two role tiers (`User.role: 'user' | 'admin'`, `backend/app/modules/main/models/user.py`):

| Role | Module access | Notes |
|---|---|---|
| `admin` | All modules automatically, regardless of `assigned_apps` (`get_apps()`) | Also manages other users, sees audit logs, feedback inbox |
| `user` | Only modules listed in their `assigned_apps` (`AppModule[]`: `erp`, `rnd`, `crm`, `purchase`, `p2p`) | Per-module, opt-in |

ERP additionally has granular sub-permissions layered on top of module access (`User.erp_permissions: string[]`, checked via `hasErpPermission()` in `frontend/src/hooks/useAuth.ts`):

| Group | Permissions |
|---|---|
| Projects | `project_view`, `project_create`, `project_edit`, `project_delete` |
| Service Requests | `sr_view`, `sr_create`, `sr_edit`, `sr_delete` |

These are assigned per-user from the Users & Roles admin page (`frontend/src/app/dashboard/users/page.tsx`).

**User personas** (inferred from module shape, not a formal survey):
- **Sales / BD user** — CRM only: inquiries, tenders, activities.
- **Service engineer / coordinator** — ERP: projects, service requests, materials.
- **Purchase officer** — `purchase` and/or `p2p`: approves/tracks PRs.
- **R&D engineer** — `rnd`: calculators and report history.
- **Admin** — all modules, user management, audit oversight.

## Business Processes

### 1. Service Request lifecycle (ERP)

`SRStatus`: `open → acknowledged → assigned → scheduled → in_progress → pending_parts → on_hold → work_completed → review → closed` (with `cancelled` as an off-ramp at any point). Priority: `critical | high | medium | low`.

A Service Request belongs to a `Project` (the client machine record). It carries materials (`ServiceMaterial`), attachments (SharePoint-backed), and can raise a Purchase Requisition directly from its materials tab (`POST /{sr_id}/raise-pr`). Receiving materials against the SR (`POST /{sr_id}/materials/{mat_id}/receive`) mirrors back onto the linked PR's status.

### 2. CRM Inquiry / Tender lifecycle

An `Inquiry` (or `Tender`, for competitive bids) progresses through stage logs (`StageLogResponse`), can have cross-department `InquiryTask`/`TenderTask` assignments, `InquiryApproval` gates, and produces `Quotation` → `PurchaseOrder` (the *customer's* PO, distinct from the Purchase module's vendor PO). Tenders additionally track competitors (`TenderCompetitor`). Activities (calls, meetings, site visits) log against Organizations/Inquiries/Tenders with photos and structured Minutes of Meeting, exportable to Word/PDF.

**Ambiguity flagged in `DEPARTMENT_MODULES_ROADMAP.md`:** whether Inquiry → customer PO → `erp_projects` is actually wired end-to-end has not been confirmed — worth tracing before building further on top.

### 3a. Purchase Requisition — SR-linked (`purchase` module)

`PRStatus`: `submitted → approved → po_raised → partially_received | received → closed`, with `rejected`/`cancelled` off-ramps. Raised only from an existing Service Request's material list (qty-only snapshot, no cost fields). `vendor`/`po_number`/`po_date` are free-text, filled in after the fact — no vendor master or generated PO document yet. Each line item has `item_status: pending | partial | received` and now carries `remarks` plus a read-only photo gallery.

### 3b. Purchase Requisition — standalone module (`p2p`)

Same status enum (`P2PRequestStatus`, identical values to `PRStatus`), but a materially richer, department-agnostic lifecycle: `submit → approve/reject → assign-buyer → request-quotations → select-vendor → create-po → update-receipt → close`. This is *not* tied to a Service Request — any department raises it directly, with its own category metadata (`GET /meta`), line items (item/part/model/qty/budget/reason), and typed attachments (`supporting | specification | po_document`). This module is functionally ahead of the SR-linked `purchase` module for several phases described in `PURCHASE_MODULE_PLAN.md` (buyer assignment, RFQ, vendor selection, PO issuance, receipt tracking) — see the roadmap note below.

## Feature List (by module, derived from actual routes/pages)

### ERP (`erp/routes/projects.py`, `erp/routes/service_requests.py`; pages under `frontend/src/app/dashboard/erp/`)
- Project CRUD, filter options, soft-delete + recycle bin + restore, audit trail
- Project attachments (SharePoint) with per-attachment permission control
- Service Request CRUD, soft-delete + recycle bin + restore, audit trail
- Service Request attachments (upload/preview/content/delete) via SharePoint
- Materials tab per SR: CRUD, per-item attachments, mark received, raise PR directly from materials
- Resend client email, test-email endpoint
- Reports page (`dashboard/erp/reports`)

### CRM (`crm/routes/*.py`; pages under `frontend/src/app/dashboard/crm/`)
- Organizations: CRUD, contacts sub-resource, recycle bin, audit, name search, detail rollup
- Inquiries: CRUD, recycle bin, audit, stage logs, MOM export (DOCX + PDF)
- Tenders: CRUD, recycle bin, audit, stage logs
- Workflow: cross-entity tasks (Inquiry/Tender), approvals, quotations, purchase orders, competitors, discussions
- Activities: CRUD, photo attachments, team-member listing
- Notes: CRUD
- Documents: list/upload/delete
- Bulk import: organizations, inquiries, tenders, activities
- Dashboard summary endpoint

### R&D (`rnd/routes/*.py`, `rnd/tools/*/api.py`; pages under `frontend/src/app/dashboard/rnd/`)
- Calculators: braking, hydraulic, load distribution, qmax, spline, tractive effort, vehicle performance — each with `/calculate` + PDF/DOCX report download
- Calculation history: save/list/detail/rename/delete, plus admin-wide history view across users

### Purchase — SR-linked (`purchase/routes/purchase_requisitions.py`; pages `dashboard/purchase/`, `dashboard/purchase/[id]`)
- List/detail, audit trail
- Edit PR, edit line item (remarks)
- Approve / reject / cancel / close
- Note: `dashboard/purchase/vendors`, `orders`, `rfqs`, `grn`, `invoices` directories exist under `frontend/src/app/dashboard/purchase/` but currently contain no `page.tsx` — placeholders for `PURCHASE_MODULE_PLAN.md` phases, not yet implemented.

### Purchase Requisition — standalone (`p2p/routes/p2p_requests.py`; pages `dashboard/p2p/`, `dashboard/purchase/p2p-requests/`)
- Category metadata, create, list, detail, audit
- Edit, approve, reject, cancel
- Assign buyer, request quotations, select vendor, create PO, update receipt, close
- Attachments (typed: supporting/specification/po_document), upload/delete
- A dedicated Purchase-team view lives at `dashboard/purchase/p2p-requests/`, distinct from the requester-facing `dashboard/p2p/`

### Admin / Main (`main/routes/*.py`; pages `dashboard/users/`)
- Auth: Microsoft SSO login/callback, Teams token exchange, `/auth/me`, logout
- Users: list, directory, edit, activate/deactivate, sync from Azure AD
- Per-user `assigned_apps` and `erp_permissions` management UI
- Notifications: unread count, list, mark read/read-all
- Feedback: submit, list, unread count, mark read (admin-facing bell)
- Presence: heartbeat, per-resource presence lookup
- API keys: list, create, revoke

## Product Roadmap

Concrete, code-backed roadmap items (from `PURCHASE_MODULE_PLAN.md`, `DEPARTMENT_MODULES_ROADMAP.md`, and recent `frontend/src/lib/changelog.ts` entries):

- **Purchase (SR-linked) module** — vendor master, formal PO documents, costing/budget, GRN, invoice visibility, reporting dashboard (Phases 1–6 of `PURCHASE_MODULE_PLAN.md`) are still on paper only for this module; the empty `vendors/orders/rfqs/grn/invoices` frontend directories mark where they'll land. **The standalone `p2p` module already implements the buyer/RFQ/vendor/PO/receipt shape** described there — worth deciding whether the SR-linked module should converge onto it instead of building a parallel Phase 1–4.
- **New departments** (Design, Electrical, Fluids, Production, Store, Quality, Maintenance, Operations, Project Management, Vendor Development) — fully scoped on paper in `DEPARTMENT_MODULES_ROADMAP.md`, `DESIGN_MODULE_PLAN.md`, `ELECTRICAL_MODULE_PLAN.md`; none have backend/frontend code yet.
- **Module registry** — access control is currently a hardcoded set (`AVAILABLE_APPS` in `backend/app/modules/main/models/user.py`, mirrored by hand in `AppModule`, `useAuth.ts`, and the admin UI). Flagged as needing to become DB-backed before more than 2–3 more departments are added.
- **Near-term shipped work** (evidence from `changelog.ts`, dated 2026-08-02 through 2026-08-05): CRM activity photos, Minutes of Meeting PDF export, a Feedback inbox, Purchase Requisition material remarks/photos, calendar UI fix. No further roadmap beyond what's captured in the plan docs above is documented anywhere in the codebase — anything past this should be treated as unconfirmed until a stakeholder states it.

## Key Metrics, Success Criteria, Constraints, Assumptions, Risks, Terms, Contact

Retained from the original draft — these were forward-looking/aspirational statements, not derived from code, and are not contradicted by anything found in the codebase. Treat them as still-open items for a product owner to confirm or update, not as verified facts:

- **Key Metrics**: adoption %, DAU/WAU, satisfaction/NPS, page load & API latency.
- **Success Criteria**: 80% adoption, 1hr/week productivity gain, >4/5 satisfaction, >99.5% uptime, <2s page loads.
- **Constraints**: limited IT budget, ~100 concurrent users, ~10GB/year data, GDPR/enterprise compliance.
- **Assumptions**: continued Microsoft 365 licensing, stable business processes, 2-3 dedicated engineers.
- **Risks**: user adoption, scope creep, performance, legacy data migration.
- **Terms**: Portal = the web app; Module = one of the five above; User = employee with access; Admin = elevated-permission user.
- **Contact**: Product Manager / Technical Lead / Stakeholder — names not filled in in the source doc; unresolved.

## Non-Goals

Unchanged from the original — see "Scope" above for the current, code-confirmed out-of-scope list.

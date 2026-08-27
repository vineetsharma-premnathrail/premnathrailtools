# Scope Document — Premnathrail Portal

> Derived from `docs/product/PRODUCT.md` §Scope, cross-checked against actual routes/pages. See [Project Charter](PROJECT_CHARTER.md) for objectives/stakeholders.

## 1. In Scope — Built and Live

### CRM (`backend/app/modules/crm/`)
- Organization/contact management with recycle bin
- Inquiry → Tender → Quotation → customer PO pipeline, with stage logs
- Cross-department task assignment, approval gates, competitor tracking (Tenders)
- Activities (calls/meetings/site visits) with photos, structured Minutes of Meeting export (Word/PDF)
- Bulk import (organizations, inquiries, tenders, activities)
- Notes, documents, dashboard summary

### ERP / Service (`backend/app/modules/erp/`)
- Machine/project registry with full lifecycle dates (warranty, AMC, commissioning)
- Service Request ticketing: full status lifecycle, materials tracking, SharePoint attachments
- Recycle bin + restore, audit trail on both Projects and Service Requests
- Raise a Purchase Requisition directly from a Service Request's materials list

### R&D (`backend/app/modules/rnd/`)
- 7 engineering calculators (braking, hydraulic, load distribution, qmax, spline, tractive effort, vehicle performance)
- PDF/DOCX report export per calculation
- Calculation history (save/list/detail/rename/delete), admin-wide history view

### Purchase — SR-linked (`backend/app/modules/purchase/`)
- PR lifecycle raised only from an existing Service Request's material list
- Approve/reject/cancel/close, line-item remarks + photo gallery
- No vendor master or generated PO document — `vendor`/`po_number`/`po_date` are free text

### Purchase Requisition — standalone (`backend/app/modules/p2p/`)
- Department-agnostic PR lifecycle: submit → approve/reject → assign buyer → RFQ → vendor selection → PO → receipt tracking → close
- Typed attachments (supporting/specification/po_document)
- Functionally ahead of the SR-linked Purchase module for buyer/RFQ/vendor/PO/receipt phases

### Admin / Main (`backend/app/modules/main/`)
- Microsoft SSO auth (login, callback, Teams token exchange, `/auth/me`, logout)
- User directory, per-module access (`assigned_apps`), granular ERP sub-permissions, Azure AD sync
- Audit log, notifications, feedback inbox, API keys

## 2. Explicitly Out of Scope

| Item | Reason | Status |
|---|---|---|
| Accounting/finance module (general ledger) | System of record was SAP | ⚠️ **Reversed 2026-08-18** — a full parallel GL/AP/AR ledger is now confirmed and scoped in `ACCOUNTS_DEPARTMENT_MODULE_PLAN.md`. Treat "out of scope" as historical only. |
| HR module | System of record is ADP | Still out of scope |
| Email client | Use Outlook | Still out of scope |
| Document management | Use SharePoint — portal stores attachment *references* only, never re-implements storage | Still out of scope |

## 3. Planned but Not Yet Built

- **New departments**: Design, Electrical, Fluids, Production, Store, Quality, Maintenance, Operations, Project Management, Vendor Development — fully scoped on paper (`DEPARTMENT_MODULES_ROADMAP.md` + individual `*_MODULE_PLAN.md` files), zero backend/frontend code.
- **Purchase (SR-linked) module gaps**: vendor master, formal PO documents, costing/budget, GRN, invoice tracking, reporting dashboard (Phases 1–6, `PURCHASE_MODULE_PLAN.md`). Open question: converge onto the standalone `p2p` module instead of building a parallel implementation.
- **Module registry**: access control is a hardcoded set (`AVAILABLE_APPS`) needing to become DB-backed before more departments are added.

## 4. Scope Boundaries — What This Document Does NOT Cover

- Detailed acceptance criteria per feature → see `docs/requirements/ACCEPTANCE_CRITERIA.md`
- Field-level functional behavior → see `docs/requirements/FUNCTIONAL_REQUIREMENTS.md`
- Non-functional requirements (performance, security targets) → see `docs/requirements/NON_FUNCTIONAL_REQUIREMENTS.md`
- Change control process → see Change Request Document (not yet created)

## 5. Known Ambiguity

Whether Inquiry → customer PO → `erp_projects` is wired end-to-end has not been confirmed (flagged in `DEPARTMENT_MODULES_ROADMAP.md`) — verify before building further on top of that boundary.

## 6. Change Control

No formal Change Request process exists yet. Currently, scope changes are recorded as inline historical flags directly in `PRODUCT.md` (see the Accounts module reversal above). Until a Change Request Document/process is created, treat any scope change as needing: (1) a note in this document's relevant section, (2) an entry in `PRODUCT.md`, (3) an ADR if it's an architectural decision.

---
*Last updated: 2026-08-27. Update this document whenever a module is added/removed, an out-of-scope item is reversed, or a new department is greenlit — keep it in sync with `PRODUCT.md` §Scope, which remains the fuller narrative source.*

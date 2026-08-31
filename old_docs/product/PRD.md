# Product Requirements Document (PRD) — Premnathrail Portal

> States product goals, users, features, and expected outcomes. Derived from `docs/product/PRODUCT.md` + actual routes/pages. See [BRD](BRD.md) for the business-need framing this fulfills, and `docs/requirements/FUNCTIONAL_REQUIREMENTS.md` for field-level behavior.

## 1. Product Vision

> "A single, integrated internal platform where Premnathrail employees manage customer relationships, field service and machine records, purchasing, and engineering calculations — replacing scattered spreadsheets and email threads with one system of record, without duplicating what SAP, ADP, or SharePoint already do well."

## 2. Goals

1. Consolidate CRM, field service, purchasing, and engineering-calculation workflows into one portal.
2. Make every workflow end-to-end auditable (stage logs, audit trail, recycle bin).
3. Keep access tightly scoped per module and, for ERP, per sub-action.
4. Authenticate via existing company Microsoft identity — zero new credential surface.

## 3. Target Users

| Persona | Primary Module(s) | Key Jobs-to-be-Done |
|---|---|---|
| Sales / BD user | CRM | Log inquiries, progress tenders, generate quotations, export MOM |
| Service engineer / coordinator | ERP | Manage machine registry, run Service Requests, track materials |
| Purchase officer | Purchase, P2P | Approve/track requisitions, manage vendor selection and receipt |
| R&D engineer | R&D | Run engineering calculators, generate client-ready reports |
| Admin | All + Main | Manage users/roles/permissions, audit oversight, feedback triage |

## 4. Feature Set (Live)

### CRM
- Organization/contact management, recycle bin
- Inquiry → Tender → Quotation → customer PO pipeline with stage logs
- Cross-department task assignment, approval gates, competitor tracking
- Activities with photos, Minutes of Meeting export (Word/PDF)
- Bulk import, dashboard summary

### ERP (Service)
- Machine/project registry (warranty, AMC, commissioning dates)
- Service Request ticketing: full status lifecycle, materials, SharePoint attachments
- Raise PR directly from SR materials; receipt tracking mirrors back to linked PR
- Recycle bin, audit trail, reports page

### R&D
- 7 calculators: braking, hydraulic, load distribution, qmax, spline, tractive effort, vehicle performance
- PDF/DOCX report export per calculation
- Calculation history, admin-wide history view

### Purchase (SR-linked)
- PR lifecycle from SR materials list through closure
- Approve/reject/cancel/close, line-item remarks + photos

### Purchase Requisition (Standalone / P2P)
- Department-agnostic: submit → approve → assign buyer → RFQ → vendor selection → PO → receipt → close
- Typed attachments (supporting/specification/po_document)

### Admin / Main
- Microsoft SSO auth, JWT session
- User directory, per-module + per-permission access control, Azure AD sync
- Audit log, notifications, feedback inbox, API keys

## 5. Expected Outcomes

- Single system of record replacing spreadsheets/email for the five workflows above.
- Full audit trail on every destructive action (soft-delete + recycle bin, never hard delete).
- Reduced manual report generation time for R&D (calculator → PDF/DOCX in one step).
- End-to-end visibility on Service Request → PR → receipt, without leaving the portal.

## 6. Non-Goals (Product Level)

Full detail in [Scope Document §2](SCOPE_DOCUMENT.md#2-explicitly-out-of-scope): no accounting ledger duplication *(reversed 2026-08-18 — Accounts now in scope, see `ACCOUNTS_DEPARTMENT_MODULE_PLAN.md`)*, no HR module, no email client, no document management (SharePoint references only).

## 7. Roadmap (Planned, Not Built)

- 10 new departments on paper: Design, Electrical, Fluids, Production, Store, Quality, Maintenance, Operations, Project Management, Vendor Development (`DEPARTMENT_MODULES_ROADMAP.md`)
- Purchase (SR-linked) gaps: vendor master, formal PO documents, costing, GRN, invoice tracking, reporting dashboard — open question whether to converge onto the standalone P2P module instead
- Module registry: move `AVAILABLE_APPS` from hardcoded to DB-backed before adding more departments

## 8. Success Metrics

Same targets as BRD/Charter (open, unconfirmed by a stakeholder): 80% adoption, ~1hr/week productivity gain per user, >4/5 satisfaction, >99.5% uptime, <2s page loads.

## 9. Risks

Carried from `PRODUCT.md`: user adoption, scope creep, performance at scale, legacy data migration.

## 10. Open Questions

- Is Inquiry → customer PO → `erp_projects` actually wired end-to-end? (unconfirmed, `DEPARTMENT_MODULES_ROADMAP.md`)
- Should the SR-linked Purchase module converge onto the more mature standalone P2P module rather than building a parallel Phase 1–4?

---
*Last updated: 2026-08-27. Update the Feature Set and Roadmap sections whenever a module ships or a roadmap item is confirmed/dropped — keep in sync with `PRODUCT.md`, the fuller narrative source.*

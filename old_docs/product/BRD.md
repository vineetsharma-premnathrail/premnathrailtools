# Business Requirements Document (BRD) — Premnathrail Portal

> Derived from `docs/product/PRODUCT.md` (Business Requirements, Business Processes) + actual routes/models. Companion to [Project Charter](PROJECT_CHARTER.md) and [Scope Document](SCOPE_DOCUMENT.md). This document states *what the business needs* — see `docs/requirements/SRS.md` and `FUNCTIONAL_REQUIREMENTS.md` for how the software fulfills it.

## 1. Business Context

Premnathrail (railway equipment company) currently coordinates CRM, field service, purchasing, and engineering work through spreadsheets and email. The business needs one system of record for these workflows, without duplicating SAP (finance), ADP (HR), or SharePoint (documents).

## 2. Business Requirements

Numbered to match `PRODUCT.md`'s Business Requirements list — treat that file as the source of truth if these ever diverge:

| # | Requirement | Owning Module | Status |
|---|---|---|---|
| BR-1 | Every field service issue against a client machine must be trackable end-to-end (open → resolved → billed) with an audit trail | ERP (Service Request) | ✅ Built — `SRStatus` lifecycle, audit trail |
| BR-2 | Every material requested for a service job must be requisitioned, approved, and tracked through receipt | ERP + Purchase | ✅ Built — `raise-pr` from SR materials, receipt tracking |
| BR-3 | Sales/BD must track an inquiry from first contact through tender, quotation, and customer PO without leaving the portal | CRM | ✅ Built — Inquiry/Tender stage logs, Quotation → PO |
| BR-4 | Engineers must run standard railway calculations and produce a client-ready PDF/DOCX report without manual spreadsheet work | R&D | ✅ Built — 7 calculators with report export |
| BR-5 | Access must be controllable per module and, for ERP, per sub-action (view/create/edit/delete on Projects and Service Requests separately) | Main (Admin) | ✅ Built — `assigned_apps`, `erp_permissions` |
| BR-6 | All destructive actions (delete) must be soft-deletes with a recycle bin and restore path, not permanent | All modules | ✅ Built — recycle bin pattern across CRM/ERP |
| BR-7 | Authentication must be via company Microsoft accounts (SSO) — no separate password system | Main (Auth) | ✅ Built — Microsoft SSO, JWT session |

## 3. Business Processes in Scope

### 3.1 Service Request Lifecycle (ERP)
`open → acknowledged → assigned → scheduled → in_progress → pending_parts → on_hold → work_completed → review → closed` (with `cancelled` as an off-ramp). Priority: `critical | high | medium | low`. Belongs to a Project (client machine record); carries materials and SharePoint-backed attachments.

### 3.2 CRM Inquiry / Tender Lifecycle
Inquiry (or Tender for competitive bids) progresses through stage logs, cross-department task assignments, approval gates, and produces Quotation → customer PO. Tenders track competitors. Activities log against Organizations/Inquiries/Tenders with photos and Minutes of Meeting export.

**Open question**: whether Inquiry → customer PO → `erp_projects` is wired end-to-end is unconfirmed — flagged in `DEPARTMENT_MODULES_ROADMAP.md`.

### 3.3 Purchase Requisition — SR-linked
`submitted → approved → po_raised → partially_received | received → closed` (with `rejected`/`cancelled` off-ramps). Raised only from an existing Service Request's material list — qty-only, no cost fields, no vendor master.

### 3.4 Purchase Requisition — Standalone (P2P)
Same status values, richer lifecycle: `submit → approve/reject → assign-buyer → request-quotations → select-vendor → create-po → update-receipt → close`. Department-agnostic, not tied to a Service Request.

## 4. Stakeholder Needs

| Persona | Need | Module |
|---|---|---|
| Sales / BD user | Track inquiries/tenders without leaving the portal | CRM |
| Service engineer / coordinator | Manage Projects, Service Requests, materials | ERP |
| Purchase officer | Approve/track PRs (SR-linked and/or standalone) | Purchase, P2P |
| R&D engineer | Run calculators, keep report history | R&D |
| Admin | Manage users/roles, view audit logs, feedback | Main |

*(Personas inferred from module access shape, not a formal stakeholder survey — see `PRODUCT.md`.)*

## 5. Business Rules

- Two role tiers only: `admin` (all modules automatically) and `user` (only `assigned_apps`).
- ERP has additional granular sub-permissions (`project_*`, `sr_*`) layered on top of module access.
- No separate password system — Microsoft SSO is the sole auth path.
- Delete is always soft-delete with recycle bin + restore, never hard delete, across all modules.

## 6. Out of Scope (Business Level)

See [Scope Document §2](SCOPE_DOCUMENT.md#2-explicitly-out-of-scope) for full detail: Accounting (reversed 2026-08-18, now in scope), HR (ADP), Email (Outlook), Document management (SharePoint — reference-only).

## 7. Success Metrics

Carried from `PRODUCT.md`, flagged there as open targets, not measured facts: 80% adoption, ~1hr/week productivity gain, >4/5 satisfaction, >99.5% uptime, <2s page loads.

## 8. Assumptions & Constraints

- Continued Microsoft 365 licensing
- Relatively stable business processes
- ~2-3 dedicated engineers
- ~100 concurrent users, ~10GB/year data growth
- Limited IT budget, GDPR/enterprise compliance

## 9. Approval

| Name | Role | Date |
|---|---|---|
| ⚠️ not named in source docs | Business Owner | |
| ⚠️ not named in source docs | Product Manager | |

---
*Last updated: 2026-08-27. Update whenever a new business requirement (BR-N) is confirmed by a stakeholder, or an existing one's status changes.*

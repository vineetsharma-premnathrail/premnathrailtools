# Project Charter — Premnathrail Portal

> Status: Draft, derived from codebase + `PRODUCT.md`. Names/dates marked ⚠️ are unresolved — a stakeholder must fill them in.

## 1. Purpose

Replace scattered spreadsheets, email threads, and manual coordination across Premnathrail's departments with a single internal system of record — without duplicating what SAP, ADP, or SharePoint already do well.

## 2. Project Objectives

1. Give every field service issue against a client machine an end-to-end trackable lifecycle (open → resolved → billed) with an audit trail.
2. Make every material requested for a service job requisitioned, approved, and tracked through receipt.
3. Let Sales/BD track an inquiry from first contact through tender, quotation, and customer PO without leaving the portal.
4. Let engineers run standard railway calculations and produce client-ready reports without manual spreadsheet work.
5. Provide per-module and per-action access control, with soft-delete + recycle bin on all destructive actions.
6. Authenticate exclusively via company Microsoft accounts (SSO) — no separate password system.

## 3. Business Justification

Premnathrail currently coordinates CRM, field service, purchasing, and engineering calculation work through disconnected tools (spreadsheets, email, verbal handoffs). This causes lost audit trails, duplicate data entry, and no single view of a client machine's service/purchase history. The portal consolidates these workflows while explicitly staying out of SAP's (finance), ADP's (HR), and SharePoint's (document storage) territory — see `PRODUCT.md` §Scope for the current exception (Accounts/GL, reversed 2026-08-18).

## 4. Scope Summary

Five live modules — CRM, ERP (Service), R&D, Purchase (SR-linked), Purchase Requisition (standalone/P2P) — plus a `main` module for auth, users/roles, audit, notifications. Full in/out-of-scope breakdown lives in the companion [Scope Document](SCOPE_DOCUMENT.md) — this charter does not duplicate it.

## 5. Stakeholders

| Role | Who | Notes |
|---|---|---|
| Executive Sponsor | ⚠️ not named in source docs | Unresolved — confirm with leadership |
| Product Manager / Technical Lead | ⚠️ not named in source docs | Unresolved — `PRODUCT.md` flags the same gap |
| Engineering Team | Premnathrail Engineering Team (per `README.md` Authors) | ~2-3 dedicated engineers assumed (`PRODUCT.md` Assumptions) |
| End Users | Sales/BD, Service engineers/coordinators, Purchase officers, R&D engineers, Admins | Personas inferred from module access shape, not a formal survey |

## 6. Authority / Decision Rights

- **Module/access-control decisions** (which department gets which permissions) — Admin role, exercised via Users & Roles admin page.
- **Scope changes** (new module, reversing an out-of-scope item) — tracked historically as inline flags in `PRODUCT.md` (e.g. the 2026-08-18 Accounts reversal); no formal Change Request process exists yet — see the not-yet-created Change Request Document.
- **Architectural decisions** — recorded as ADRs in `docs/adr/` (0001–0003 exist).

## 7. High-Level Timeline / Milestones

No formal project plan exists yet (see Project Plan / Project Tracker, both pending). What's actually shipped, from `changelog.ts` and `DEPARTMENT_MODULES_ROADMAP.md`:

- **Shipped**: CRM, ERP, R&D, Purchase (SR-linked), Purchase Requisition (standalone) — all live, backend + frontend.
- **Recent** (2026-08-02 to 2026-08-05): CRM activity photos, MOM PDF export, Feedback inbox, PR material remarks/photos.
- **Planned, not built**: 10 new departments (Design, Electrical, Fluids, Production, Store, Quality, Maintenance, Operations, Project Management, Vendor Development) — see `DEPARTMENT_MODULES_ROADMAP.md`.

## 8. Constraints & Assumptions

Carried from `PRODUCT.md` (flagged there as aspirational/unconfirmed, not code-derived):
- **Constraints**: limited IT budget, ~100 concurrent users, ~10GB/year data growth, GDPR/enterprise compliance.
- **Assumptions**: continued Microsoft 365 licensing, relatively stable business processes, 2-3 dedicated engineers.

## 9. Success Criteria

- 80% user adoption
- ~1 hour/week productivity gain per user
- >4/5 user satisfaction
- >99.5% uptime
- <2s page loads

*(Same caveat as `PRODUCT.md`: these are open targets for a product owner to confirm, not measured facts.)*

## 10. Approval

| Name | Role | Signature/Date |
|---|---|---|
| ⚠️ | Sponsor | |
| ⚠️ | Product Owner | |

---
*Last updated: 2026-08-27. Review this charter whenever scope, sponsor, or top-level objectives change — see `docs/README.md` (master index) for update cadence guidance.*

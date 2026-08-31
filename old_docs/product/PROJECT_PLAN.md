# Project Plan — Premnathrail Portal

> Defines tasks, milestones, timelines, and deliverables. Derived from `DEPARTMENT_MODULES_ROADMAP.md`, `PURCHASE_MODULE_PLAN.md`, and other `*_MODULE_PLAN.md` files, plus shipped evidence from `changelog.ts`. No formal timeline/dates exist anywhere in the codebase — this plan captures **what** and **order**, not committed dates, until a stakeholder assigns them.

## 1. Completed Milestones (Live in Production)

| Milestone | Modules | Evidence |
|---|---|---|
| M0 — Core platform | Main (auth/users/roles), Microsoft SSO | `README.md`, `backend/app/modules/main/` |
| M1 — CRM launch | Organizations, Inquiries, Tenders, Activities, Workflow | `backend/app/modules/crm/` |
| M2 — ERP/Service launch | Projects, Service Requests, materials | `backend/app/modules/erp/` |
| M3 — R&D launch | 7 calculators + report export | `backend/app/modules/rnd/` |
| M4 — Purchase (SR-linked) launch | PR from SR materials | `backend/app/modules/purchase/` |
| M5 — Purchase Requisition (standalone/P2P) launch | Full buyer→RFQ→PO→receipt lifecycle | `backend/app/modules/p2p/` |
| M6 — Recent feature wave (2026-08-02 to 2026-08-05) | CRM activity photos, MOM PDF export, Feedback inbox, PR remarks/photos | `frontend/src/lib/changelog.ts` |

## 2. Upcoming Work (Not Yet Started, Prioritized)

Priority order below is a **suggested** sequencing based on dependency and risk (see [Risk Register](RISK_REGISTER.md)), not a stakeholder-confirmed roadmap — reorder once a product owner weighs in.

### Phase A — Foundational fixes (should precede new departments)
1. **Module registry migration** — move `AVAILABLE_APPS` from hardcoded to DB-backed (R-01)
2. **Resolve Purchase module convergence** — decide SR-linked vs standalone P2P direction (R-02)
3. **Confirm Inquiry → PO → erp_projects wiring** (R-03)

### Phase B — Purchase (SR-linked) module completion
Per `PURCHASE_MODULE_PLAN.md` Phases 1–6: vendor master, formal PO documents, costing/budget, GRN, invoice tracking, reporting dashboard. *(Contingent on Phase A item 2's decision.)*

### Phase C — New department modules
Per `DEPARTMENT_MODULES_ROADMAP.md`, in the order the individual `*_MODULE_PLAN.md` files exist (no confirmed priority order found — flagged for stakeholder input):
- Design, Electrical, Fluids, Production, Store, Quality, Maintenance, Operations, Project Management, Vendor Development
- Accounts department (GL/AP/AR) — already approved 2026-08-18, see `ACCOUNTS_DEPARTMENT_MODULE_PLAN.md`

### Phase D — Cross-cutting hardening
- Expand automated test coverage (`README.md` Next Steps)
- Add rate limiting (`README.md` Next Steps)
- Production deployment guide (`README.md` Next Steps)
- Fill in missing docs per [docs/README.md](../README.md) pending list

## 3. Deliverables per Phase

| Phase | Key Deliverable | Definition of Done |
|---|---|---|
| A | Module registry, convergence decision, wiring confirmation | ADR recorded for each decision |
| B | Vendor master, PO generation, costing, GRN, invoicing, dashboard | Matches `PURCHASE_MODULE_PLAN.md` acceptance criteria |
| C | Each department's backend module + frontend pages | Matches its `*_MODULE_PLAN.md`, has API docs + tests |
| D | Test coverage report, rate-limit config, deployment guide | Docs updated per [docs/README.md](../README.md) |

## 4. Timeline

⚠️ No dates committed anywhere in source material — this section intentionally left for a Product Manager/stakeholder to fill in (same gap flagged in Charter §9 and PRD).

## 5. Dependencies

- Phase B depends on Phase A item 2 (convergence decision)
- Phase C (new departments) depends on Phase A item 1 (module registry) per `PRODUCT.md` explicit note: "flagged as needing to become DB-backed before more than 2-3 more departments are added"

---
*Last updated: 2026-08-27. See [PROJECT_TRACKER.md](PROJECT_TRACKER.md) for live task-level status of this plan.*

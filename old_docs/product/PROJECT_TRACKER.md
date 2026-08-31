# Project Tracker — Premnathrail Portal

> Tracks ongoing work, ownership, priority, and status. Companion to [PROJECT_PLAN.md](PROJECT_PLAN.md) (which defines the phases/deliverables) — this file is the living, task-level status board. Update this file as work happens; it is not derived automatically.

## How to Use

- One row per task. Keep status current — this is meant to be edited often, unlike the more static Plan/Charter docs.
- Status values: `Not Started`, `In Progress`, `Blocked`, `Done`
- Priority: `P0` (foundational/blocking) `P1` (high) `P2` (medium) `P3` (low)

## Phase A — Foundational Fixes

| Task | Owner | Priority | Status | Notes |
|---|---|---|---|---|
| Move `AVAILABLE_APPS` to DB-backed module registry | ⚠️ unassigned | P0 | Not Started | Blocks Phase C, see R-01 |
| Decide Purchase (SR-linked) vs P2P convergence | ⚠️ unassigned | P0 | Not Started | Blocks Phase B, see R-02 |
| Confirm Inquiry → PO → erp_projects wiring | ⚠️ unassigned | P1 | Not Started | See R-03 |

## Phase B — Purchase (SR-linked) Completion

| Task | Owner | Priority | Status | Notes |
|---|---|---|---|---|
| Vendor master | ⚠️ unassigned | P2 | Not Started | Contingent on convergence decision |
| Formal PO document generation | ⚠️ unassigned | P2 | Not Started | |
| Costing/budget fields | ⚠️ unassigned | P2 | Not Started | |
| GRN (goods receipt note) | ⚠️ unassigned | P2 | Not Started | |
| Invoice tracking | ⚠️ unassigned | P2 | Not Started | |
| Reporting dashboard | ⚠️ unassigned | P3 | Not Started | |

## Phase C — New Departments

| Department | Owner | Priority | Status | Notes |
|---|---|---|---|---|
| Accounts (GL/AP/AR) | ⚠️ unassigned | P1 | Not Started | Approved 2026-08-18, plan exists |
| Design | ⚠️ unassigned | P3 | Not Started | Plan exists, no code |
| Electrical | ⚠️ unassigned | P3 | Not Started | Plan exists, no code |
| Fluids | ⚠️ unassigned | P3 | Not Started | Plan exists, no code |
| Production | ⚠️ unassigned | P3 | Not Started | Plan exists, no code |
| Store | ⚠️ unassigned | P3 | Not Started | Plan exists, no code |
| Quality | ⚠️ unassigned | P3 | Not Started | Plan exists, no code |
| Maintenance | ⚠️ unassigned | P3 | Not Started | Plan exists, no code |
| Operations | ⚠️ unassigned | P3 | Not Started | Plan exists, no code |
| Project Management | ⚠️ unassigned | P3 | Not Started | Plan exists, no code |
| Vendor Development | ⚠️ unassigned | P3 | Not Started | Plan exists, no code |

## Phase D — Cross-Cutting Hardening

| Task | Owner | Priority | Status | Notes |
|---|---|---|---|---|
| Expand automated test coverage | ⚠️ unassigned | P1 | Not Started | `README.md` Next Steps |
| Add rate limiting | ⚠️ unassigned | P2 | Not Started | `README.md` Next Steps |
| Production deployment guide | ⚠️ unassigned | P1 | Not Started | `README.md` Next Steps |
| Fill missing docs (LLD, Threat Model, Test Reports, etc.) | ⚠️ unassigned | P2 | In Progress | See [docs/README.md](../README.md) pending list — Charter/BRD/PRD/Scope/Risk Register/Plan/Tracker done so far |

## Recently Completed (Reference)

| Item | Date | Source |
|---|---|---|
| CRM activity photos | 2026-08-02–05 | `changelog.ts` |
| MOM PDF export | 2026-08-02–05 | `changelog.ts` |
| Feedback inbox | 2026-08-02–05 | `changelog.ts` |
| PR material remarks/photos | 2026-08-02–05 | `changelog.ts` |
| Calendar UI fix | 2026-08-02–05 | `changelog.ts` |
| Accounts module scope approval | 2026-08-18 | `PRODUCT.md` |

---
*Last updated: 2026-08-27. Update this file directly as tasks change status — do not wait for a doc review cycle.*

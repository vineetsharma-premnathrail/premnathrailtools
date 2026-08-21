# Department Modules — Master Roadmap

Covers all 17 departments requested: Accounts, HR, Design, R&D, Production,
Store, Purchase, Operations, Fluids (Hydraulic & Pneumatic), Electrical,
Service & Commissioning, Maintenance, Quality, Admin, Project Management,
Vendor Development, Business Development.

Every department now has its own detailed phased plan (see index below). This
doc is a status index and pointer — it doesn't repeat their content. **Read
`docs/product/ALL_DEPARTMENTS_INTEGRATION.md` for the full cross-department
dependency graph and recommended build order** before starting any department
not already built.

## Plan index

| Department | Status | Plan |
|---|---|---|
| Purchase | Built (request lifecycle via `p2p` module; vendor master, PO, GRN↔Store integration, cycle count, dashboard all live) | `PURCHASE_DEPARTMENT_MODULE_PLAN.md` |
| Store | Built (stock master, locations, transactions, GRN integration, reorder trigger, cycle count) | `STORE_DEPARTMENT_MODULE_PLAN.md` |
| Purchase ↔ Store integration | Built | `PURCHASE_STORE_INTEGRATION.md` |
| Vendor Development | Substantially built (shares Purchase's `vendors` table) — dashboard/onboarding workflow extension planned | `VENDOR_DEVELOPMENT_MODULE_PLAN.md` |
| Electrical | Not built — full plan written | `ELECTRICAL_MODULE_PLAN.md` |
| Design | Not built — full plan written (owns the shared `engineering_documents` table) | `DESIGN_MODULE_PLAN.md` |
| Fluids (Hydraulic & Pneumatic) | Not built — full plan written (mirrors Electrical's shape) | `FLUIDS_MODULE_PLAN.md` |
| R&D | Built (calculation tools) — extension plan written | `RND_MODULE_EXTENSION_PLAN.md` |
| Production | Not built — full plan written | `PRODUCTION_MODULE_PLAN.md` |
| Quality | Not built — full plan written | `QUALITY_MODULE_PLAN.md` |
| Service & Commissioning | Built under `erp.ServiceRequest` — extension plan written for commissioning checklists | `SERVICE_COMMISSIONING_MODULE_PLAN.md` |
| Maintenance | Not built — full plan written | `MAINTENANCE_MODULE_PLAN.md` |
| Operations | Not built — scope ambiguous, plan covers both readings | `OPERATIONS_MODULE_PLAN.md` |
| Project Management | Not built — full plan written | `PROJECT_MANAGEMENT_MODULE_PLAN.md` |
| Business Development | Built via CRM — extension plan written | `BUSINESS_DEVELOPMENT_MODULE_EXTENSION_PLAN.md` |
| Admin | Built (users/roles/audit/notifications) — extension plan written (module registry) | `ADMIN_MODULE_EXTENSION_PLAN.md` |
| Accounts | Not built — **full ledger scope confirmed 2026-08-18** (real GL/AP/AR, not a read-only rollup — see `PRODUCT.md`'s reversed non-goal note) | `ACCOUNTS_DEPARTMENT_MODULE_PLAN.md` (supersedes `ACCOUNTS_MODULE_PLAN.md`) |
| HR | Not built — **confirm scope against `PRODUCT.md` non-goal first** | `HR_MODULE_PLAN.md` |

**Structural warning, resolved by `ADMIN_MODULE_EXTENSION_PLAN.md` Phase 1**: module access today is `AVAILABLE_APPS`, a hardcoded set in `backend/app/modules/main/models/user.py`, mirrored by hand in `frontend/src/types/index.ts`, `useAuth.ts`, and the admin UI's `APPS` array. That's fine for 6 modules (now including `store`); at 17 it's worth converting to a DB-backed module registry before building more than 2-3 of the remaining departments — see that plan for the specific migration.

## ⚠️ Accounts and HR — confirm scope first

`docs/product/PRODUCT.md` lists both as explicit non-goals: *"Accounting/finance module (exists in SAP)"* and *"HR module (exists in ADP)."* Both plans above scope these as **read-only visibility layers**, not systems of record. If the company's position has changed and a real ledger/HR system is wanted in the portal, that's a materially larger scope than either plan covers — flag it back for a dedicated plan rather than building it under these.

## Design/Electrical/Fluids table-sharing reconciliation

`ELECTRICAL_MODULE_PLAN.md` was written before `DESIGN_MODULE_PLAN.md` and independently proposes its own `electrical_documents` table. `DESIGN_MODULE_PLAN.md`'s Phase 1 flags this explicitly: whichever of the two is built first should own the shared `engineering_documents` table (with a `discipline` column), and the other should point at it instead of creating a parallel schema. `FLUIDS_MODULE_PLAN.md` is written expecting this shared table to already exist. Don't build all three independently.

## Build order

See `ALL_DEPARTMENTS_INTEGRATION.md` for the full reasoning — summary:

1. Admin's module registry (highest leverage, not a hard blocker)
2. Store, Purchase, Vendor Development — done
3. Design (owns the shared document table), then Electrical + Fluids converge onto it
4. Production (soft-depends on Design's BOM, hard-depends on Store for material issue)
5. Quality (gates Purchase's GRN, Production's stages, Service's final inspection)
6. Service & Commissioning extension, Maintenance — any time after Store
7. Operations — any time, most valuable once step 4-6 have real data
8. Project Management — Phase 1 any time, Phase 2 waits on Purchase costing + Accounts
9. Accounts, HR — any time, zero blocking relationships
10. Business Development extension, R&D extension — any time

# All Departments — Master Interconnection Map

Companion to the 17 individual department plans (see `DEPARTMENT_MODULES_ROADMAP.md` for the full index). This doc is the single place that shows how they all connect, so no department gets built in isolation from a dependency it actually needs.

## The dependency graph

```
                    ┌─────────────┐
                    │    ADMIN    │  Phase 1: DB-backed module registry
                    │ (extension) │  — build first, gates every other
                    └──────┬──────┘    department's permission key
                           │
        ┌──────────────────┼──────────────────────┐
        ▼                  ▼                       ▼
┌───────────────┐  ┌───────────────┐      ┌────────────────┐
│  DESIGN /      │  │     STORE      │      │  BUSINESS DEV   │
│  ELECTRICAL /  │  │  (stock ledger)│      │  (CRM, mostly   │
│  FLUIDS        │  │                │      │  already built) │
│ (shared doc +  │  └───────┬────────┘      └────────┬────────┘
│  work-order    │          │                         │
│  tables)       │          │ stock-in/out            │ Inquiry→PO
└───────┬────────┘          │ (function-call          │
        │ BOM /             │  exception)             ▼
        │ drawings          │                ┌─────────────────┐
        ▼                   ▼                │ erp_projects     │
┌───────────────┐  ┌────────────────┐        │ (existing)       │
│  PRODUCTION    │◄─┤   PURCHASE /    │        └────────┬────────┘
│ (build stages) │  │   P2P (already  │                 │
└───────┬────────┘  │   built)        │                 │
        │            └────────┬────────┘                 │
        │ stage gates          │ GRN → Store              │
        ▼                      │ (same function-call      │
┌───────────────┐              │  exception)              │
│    QUALITY     │◄─────────────┘                          │
│ (generic       │                                         │
│  inspection    │                                         │
│  gates on      │      ┌──────────────────┐               │
│  everyone)     │      │ VENDOR DEVELOPMENT│              │
└───────┬────────┘      │ (same `vendors`   │              │
        │                │  table as        │              │
        │                │  Purchase)        │              │
        ▼                └──────────────────┘               │
┌───────────────┐                                           │
│ SERVICE &      │◄──────────────────────────────────────────┘
│ COMMISSIONING  │  (mostly already built as erp.ServiceRequest)
└───────┬────────┘
        │
        ▼
┌───────────────┐      ┌───────────────┐      ┌──────────────────┐
│  MAINTENANCE   │      │  OPERATIONS    │      │ PROJECT MGMT      │
│ (spares from   │      │ (read-only     │      │ (tasks reuse CRM's│
│  Store)        │      │  dashboard     │      │  InquiryTask shape;│
└───────────────┘      │  over everyone)│      │  budget from       │
                        └───────────────┘      │  Purchase+Accounts)│
                                                └──────────────────┘
        ┌───────────────┐      ┌───────────────┐
        │   ACCOUNTS     │      │      HR        │
        │ (read-only     │      │ (User profile  │
        │  cost/revenue  │      │  extension,    │
        │  rollup)       │      │  own by Admin) │
        └───────────────┘      └───────────────┘

              R&D (existing) — serves calculation requests to
              Design/Fluids/Electrical, outputs land in Design's
              document repository once it exists.
```

## Build order (supersedes the informal ordering in `DEPARTMENT_MODULES_ROADMAP.md`)

1. **Admin Phase 1 — module registry.** Every other department's `require_app_access(key)` call is cheaper to add once this exists. Not a hard blocker (you can still hardcode a set for 1-2 more departments) but the highest-leverage single change in this entire roadmap.
2. **Store** (already built) + **Purchase/P2P** (already built) + **Vendor Development** (already substantially built as the same `vendors` table) — this trio is done.
3. **Design** — build the shared `engineering_documents` table here, not in Electrical (which already has an independent plan written first; reconcile per the note in `DESIGN_MODULE_PLAN.md`).
4. **Electrical** (plan already exists) and **Fluids** — both converge onto Design's shared document/work-order tables rather than each inventing their own.
5. **Production** — depends on Design's BOM (soft dependency — can build stage-tracking standalone first, add the BOM link later) and Store's stock ledger (real dependency for Phase 3 material issue).
6. **Quality** — its generic `reference_type`/`reference_id` inspection model plugs into Purchase's GRN, Production's stage gates, and Service & Commissioning's final inspection — build after at least Purchase and Production exist so there's something real to gate.
7. **Service & Commissioning** extension (mostly already built) and **Maintenance** — both can happen any time after Store exists (Maintenance's spares phase) with no other blockers.
8. **Operations** — pure read-dashboard, buildable any time, most valuable once Production/Store/Quality/Service all have real data to aggregate.
9. **Project Management** — Phase 1 (tasks/milestones) standalone-buildable any time; Phase 2 (budget vs. actual) explicitly waits on Purchase's costing phase and Accounts.
10. **Accounts** and **HR** — both are thin read-layers/profile-extensions, buildable any time, zero blocking relationship to anything else. Confirm their non-goal scope hasn't changed before starting either.
11. **Business Development extension** and **R&D extension** — both are incremental improvements to already-mature modules, no sequencing constraint.

## Shared infrastructure, don't duplicate

- **`engineering_documents`** (Design/Electrical/Fluids/R&D) — one table, `discipline` column.
- **`vendors`** (Purchase/Vendor Development) — one table, split field ownership.
- **Task assignment** (Business Development's `InquiryTask` shape) — reused by Project Management rather than a second task model.
- **Stock ledger** (`store` module) — every department that consumes or produces physical material (Purchase's GRN, Production's material issue, Maintenance's spares) posts through Store's `record_stock_transaction()` service, never a raw insert.
- **Generic reference pattern** (`reference_type`/`reference_id`) — used by Quality's inspections/NCRs and Store's stock transactions to attach to any other module's entity without a bespoke FK per integration. Reuse this shape for any future department that needs to "gate" or "annotate" another department's record.
- **Read-only rollup pattern** (Accounts, Operations' dashboard variant) — query other modules' tables directly by id, never write, never become a second source of truth for a number.
- **Mirror-field pattern** (already used throughout: `pr_number`/`pr_status` mirrored onto `ServiceMaterial`, GRN receipt status mirrored onto `P2PRequest`) — the standard way a summary field on one entity reflects another entity's authoritative data without duplicating write paths.

## Explicit non-goals, confirm before building

- **Accounts** — not a ledger/AP/AR system, SAP remains system of record, unless the company's position has changed since `PRODUCT.md` was written.
- **HR** — not payroll/attendance/leave, ADP remains system of record, same caveat.

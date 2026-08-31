# Operations Department Module — Roadmap

## ⚠️ Scope is ambiguous — confirm before building

"Operations" as named could mean two different things. Recommend a short conversation with the department to pick one rather than building both speculatively:

1. **Dispatch/logistics**: outbound shipment scheduling, transporter tracking, delivery proof — tied to `Project.delivery_date`.
2. **Cross-department ops dashboard**: a single aggregated view of open items across Production/Store/Quality/Service for daily review — no new data of its own, purely a read rollup like [[accounts]].

This plan sketches both minimally; pick whichever is causing more pain today and expand that phase fully rather than building both halfway.

## If Dispatch/Logistics

### Phase 1 — Shipment Tracking
- New `shipments`: `project_id`, transporter name/contact, dispatch date, expected/actual delivery date, tracking reference, proof-of-delivery attachment (reuse the SharePoint attachment pattern).
- Status lifecycle: `scheduled → dispatched → in_transit → delivered → delivery_confirmed`.

### Phase 2 — Delivery Performance Reporting
- On-time delivery % by transporter/project, tied into [[purchase-department]]'s vendor scorecard concept if a transporter is also a vendor.

## If Cross-Department Dashboard

### Phase 1 — Aggregated Ops View
- **No new tables.** Read-only rollup, same pattern as [[accounts]]: open production orders ([[production]]), low-stock alerts ([[store]]), pending quality inspections ([[quality]]), open service tickets ([[service-commissioning]]) — one screen, `require_app_access("operations")`, zero writes.

## Interconnections

| With | Relationship |
|---|---|
| [[production]] | Dispatch reads `Project.delivery_date`; dashboard reads production order status |
| [[store]] | Dashboard reads low-stock alerts |
| [[quality]] | Dashboard reads pending inspections; delivery proof may need a final QC sign-off first |
| [[service-commissioning]] | Dashboard reads open service tickets |

## Cross-cutting

- Register `"operations"` in `AVAILABLE_APPS` regardless of which interpretation is chosen.
- If the dashboard interpretation wins, this is one of the lowest-effort modules to build — it's pure read-aggregation, no new entities, no migrations beyond the permission key.

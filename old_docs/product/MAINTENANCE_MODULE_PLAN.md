# Maintenance Department Module — Roadmap

## Current state

No `maintenance` module exists. Distinct from [[service-commissioning]] (which is *client* machines) — this is upkeep of Premnath's **own** equipment: shop machinery, test rigs, tooling, company vehicles.

## Phase 1 — Internal Asset Register

- New `internal_assets`: asset tag, name, type (machine/rig/tool/vehicle), location, purchase date, status (`active`/`under_repair`/`decommissioned`) — deliberately separate from `erp_projects`, which represents client-deployed machines, not Premnath's own.

## Phase 2 — Preventive Maintenance Schedule

- `maintenance_schedules`: asset id, task description, frequency (days/usage-hours), last-done date, next-due date. Dashboard surfaces overdue/upcoming items.

## Phase 3 — Breakdown/Downtime Log

- `maintenance_logs`: asset id, breakdown date, downtime duration, root cause, resolution, technician, spares used.

## Phase 4 — Spares Linked to Store

- Spares consumption in a `maintenance_logs` entry posts a stock-out transaction via [[store]]'s `record_stock_transaction()` service with `reference_type="maintenance"` — same integration pattern as Production's material issue and Purchase's GRN.

## Interconnections

| With | Relationship |
|---|---|
| [[store]] | Spares issue posts stock-out transactions to the shared ledger |
| [[service-commissioning]] | Conceptually parallel (both are "keep equipment running") but distinct populations — internal assets vs. client-deployed projects; don't merge the tables |
| [[production]] | Shares the shop-floor machine registry — Production's utilization tracking and Maintenance's asset register should reference the same `internal_assets` ids where a machine is both used for production and maintained here |

## Cross-cutting

- Register `"maintenance"` in `AVAILABLE_APPS`.
- Phase 1-3 are fully standalone (no dependency on Store) — Phase 4 is the only piece that needs [[store]] to exist first.

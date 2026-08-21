# Quality Department Module — Roadmap

## Current state

No `quality` module exists. Quality gates material and work at every stage — incoming, in-process, final — which makes this one of the most cross-cutting departments to build: it doesn't own a process end-to-end so much as it inserts checkpoints into other departments' processes.

## Phase 1 — Incoming Inspection (ties to Purchase's GRN)

- New `quality_inspections`: `inspection_type` (`incoming`/`in_process`/`final`), `reference_type`/`reference_id` (generic — e.g. `p2p_grn`/grn id, `production_order`/order id), inspector, result (`accept`/`reject`/`partial`), remarks, inspected-at.
- Incoming inspection specifically ties to [[purchase-department]]'s GRN: a GRN line can carry a `quality_status` (already flagged as a free, nullable field worth adding now per that plan's Phase 4 note) that this module's inspection actually sets, rather than GRN self-certifying receipt quality.

## Phase 2 — In-Process Inspection Gates

- [[production]]'s stage tracker checks for a passing `quality_inspections` row (`inspection_type="in_process"`, matching stage) before allowing stage advancement — Quality owns the inspection record, Production only reads its status to decide whether to proceed.

## Phase 3 — Final Inspection & Test Certificate

- Final inspection before dispatch: `witness_agency`/`witness_name` fields since railway work commonly requires third-party/RDSO witness — a field Quality-specific enough that it shouldn't live on the generic `quality_inspections` row for every inspection type, so consider a `quality_final_inspections` extension table for this data specifically.
- Generated test certificate — reuse the PDF/letterhead pattern already established elsewhere.

## Phase 4 — NCR / CAPA Tracking

- `non_conformance_reports`: linked back to whichever entity triggered it (PO/production order/service request — generic reference_type/reference_id, same pattern as Phase 1), root cause, corrective action, preventive action, status (`raised → investigating → corrective_action → closed`), owner.

## Interconnections

| With | Relationship |
|---|---|
| [[purchase-department]] | Incoming inspection results feed vendor performance scoring (rejection rate) in Purchase's reporting dashboard |
| [[production]] | In-process inspection gates block stage advancement |
| [[service-commissioning]] | Final inspection/test certificate may overlap with commissioning checklists — decide ownership once both exist, don't duplicate the checklist item |
| [[store]] | A rejected incoming inspection means the GRN's stock-in either doesn't post, or posts to a quarantine location — needs explicit design once this phase is built, not left implicit |

## Cross-cutting

- Register `"quality"` in `AVAILABLE_APPS`.
- The generic `reference_type`/`reference_id` pattern on `quality_inspections` and `non_conformance_reports` is deliberate — Quality touches many other modules' entities and shouldn't need a new FK column added to itself every time a new department wants a gate. Keep this generic-reference discipline rather than growing bespoke FKs per integration.

# Design Department Module — Roadmap

## Current state

No `design` module exists. Engineering drawings/BOM ownership is distinct from R&D's calculation outputs and from Electrical's own drawings — Design owns the mechanical GA/part drawings and the master BOM; Electrical and Fluids own their own discipline-specific documents but share the same underlying document infrastructure (see Interconnections).

**⚠️ Reconciliation needed with `ELECTRICAL_MODULE_PLAN.md`**: that plan's Phase 2 independently proposes a standalone `electrical_documents` table, written before this Design plan existed. Whichever of Design or Electrical is built first should own creating the shared `engineering_documents` table below; the other should be updated to point at it instead of creating its own. Don't build both — reconcile at implementation time, not by shipping two parallel document tables.

## Phase 1 — Engineering Document Repository

- New `engineering_documents` table: `project_id` (FK `erp_projects`, id-reference only), `discipline` (`mechanical`/`electrical`/`fluids` — one shared table, not three parallel ones, per the roadmap's explicit recommendation), document type (GA drawing, part drawing, BOM, ECN, spec sheet), version/revision number, `superseded_by_id` (self-referencing, nullable) for revision history.
- Reuse the existing attachment pattern exactly: SharePoint stores bytes via `app/utils/sharepoint.py`, Postgres stores only path/webUrl/filename/content_type/size/version metadata — same mechanism as `ProjectAttachment`.
- Revision history view: see what changed between versions without leaving the portal.

## Phase 2 — Design Review & Approval Workflow

- Status lifecycle per document: `draft → under_review → approved → released → superseded`. Approval action mirrors the `AuditLog` + `notify_user` pattern already used in Purchase/P2P.
- Reviewer assignment, review comments/redlines (a simple threaded comment table, not a full markup tool).

## Phase 3 — Engineering Change Notice (ECN) Tracking

- `engineering_change_notices`: linked to `project_id`, reason, affected document ids (many-to-many via a join table), status (`raised → reviewed → approved → implemented`), impact note.
- On ECN approval, flags the affected BOM/documents as needing Production and Store attention (a notification, not an automatic data mutation — a human confirms the BOM actually changed in Production's system before anything downstream trusts it).

## Interconnections

| With | Relationship |
|---|---|
| [[electrical]], [[fluids]] | Share the same `engineering_documents` table via the `discipline` column — build this once, not three times |
| [[production]] | Production's material issue and stage-gating reads the released BOM from Design's documents — id-reference only |
| [[store]] | An ECN that changes a BOM part number may require Store to add/deprecate a `stock_item` — a notification-driven manual step initially, not an automatic sync |
| [[rnd]] | R&D calculation outputs (e.g. a load-distribution report) can become an attachable engineering document, giving R&D a natural landing spot in this same repository instead of a separate one |
| [[quality]] | Final inspection references the released drawing revision to check against |

## Cross-cutting

- Register `"design"` in `AVAILABLE_APPS`.
- Build the `engineering_documents` table with the `discipline` column from day one even though only Design uses it in Phase 1 — retrofitting Electrical/Fluids onto a Design-only table later is much more painful than adding the column up front.

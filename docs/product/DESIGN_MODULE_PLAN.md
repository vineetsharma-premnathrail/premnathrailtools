# Design Department Module — Full Plan

## Current state

No Design module exists yet. Relevant existing pieces to build on:
- `rnd` module already generates PDF/DOCX engineering reports (see `tools/spline/docx_builder.py`) — reuse this pipeline rather than inventing a second one.
- `crm.InquiryTask` already has a free-text `department` field used to assign pre-sales tasks across departments — Design already receives tasks this way during quoting, before any dedicated Design module exists.
- The SharePoint attachment pattern (`ProjectAttachment`/`ServiceRequestAttachment` — path/url/filename/content_type/size, uploaded via `app/utils/sharepoint.py`) is the proven mechanism for all file storage in this codebase and should be reused as-is, not replaced.
- As flagged in `DEPARTMENT_MODULES_ROADMAP.md`: Design, Electrical, and Fluids all need the same shape of document repository — build one `engineering_documents` table with a `discipline` column, not three parallel tables.

## Phase 1 — Drawing & Document Repository

- `engineering_documents`: `project_id` (FK `erp_projects`, nullable — standard/library parts aren't tied to one project), `drawing_number`, `title`, `revision`, `discipline` (mechanical/electrical/fluids), `document_type` (GA drawing, part drawing, assembly, BOM, ECN, DXF, STEP, SolidWorks native, PDF), uploaded_by/at.
- One drawing revision can have multiple file representations (native CAD + DXF export + PDF export + preview image) — model as a one-to-many `engineering_document_files` under each document row, all stored via the existing SharePoint pattern.
- Revision chain via a `superseded_by` pointer — old revisions stay accessible, never deleted (railway audit trail requirement).

## Phase 2 — DXF Automation

DXF is an open, text-based format — fully machine-readable with Python's `ezdxf` library. Concretely buildable:
- Auto-extract metadata on upload: layers, drawing number/title/revision from the title block or block attributes, scale, entity counts — populates the document's metadata fields instead of manual entry.
- Auto-generate a PNG/SVG preview thumbnail from the DXF (`ezdxf`'s drawing add-on or `ezdxf` + matplotlib) so drawings are viewable in-browser without AutoCAD installed.
- Lightweight validation gate before a drawing can move to "released": missing title block, wrong/missing layer naming, no scale set.
- Template-driven DXF generation from structured data — e.g. auto-produce a standard bracket or cable-schedule drawing from a form instead of redrawing it (useful for Electrical/Fluids too).

## Phase 3 — SolidWorks (native CAD) handling

SolidWorks files (`.sldprt`/`.sldasm`/`.slddrw`) are a proprietary binary format — the portal cannot parse them directly without SolidWorks itself. Realistic scope:
- Store native files as opaque attachments via the same SharePoint pattern — never parsed by the portal.
- Require/encourage a DXF + PDF export alongside every native upload, so there's always a representation the portal *can* read and preview, even without a SolidWorks seat.
- Optional, and dependent on real infrastructure (a licensed Windows machine with SolidWorks + its API) rather than pure coding: a macro/service that batch-exports DXF/PDF/STEP whenever a new native file lands. This can't run in a sandboxed environment — it needs an actual SolidWorks license and machine, so treat it as an infra ask, not a sprint task.
- STEP/IGES as the neutral 3D fallback if any downstream tool ever needs the 3D geometry without SolidWorks — openable with free tools (FreeCAD) if that need arises.

## Phase 4 — Revision Control & Review Workflow

- Status lifecycle: `draft → under_review → approved → released → superseded/obsolete`.
- Review/approval records (reviewer, comments, approved_at) — reuse the `AuditLog` entity pattern already established by Purchase.

## Phase 5 — Engineering Change Notice (ECN)

- `ecns`: reason, affected drawing(s)/BOM(s), affected project(s), disposition (use-as-is / rework / scrap), approval chain, effective date.
- Notifies Production/Store/Quality when an ECN affects an in-progress build — reuse `notify_user`/`broadcast_notification`, same as Purchase's PR notifications.

## Phase 6 — BOM Management (the highest-leverage piece)

- Structured BOM per drawing/assembly — part number, description, quantity, material, vendor reference — not a flat text field.
- This BOM becomes the shared source of truth: Purchase Requisitions and Store's stock checks read from it instead of materials being re-typed by hand in each downstream department.
- BOM diff between revisions, paired naturally with ECN tracking.

## Phase 7 — Standards Library

- Reusable library: standard parts, title blocks, drawing templates, drawing-number series with auto-suggested next number.
- Searchable parts catalog (by material, standard, prior usage) so designers aren't redrawing parts that already exist.

## Phase 8 — Task & Cross-Module Integration

- Extend `crm.InquiryTask`'s existing department-assignment pattern into a real design-task backlog once a job moves past quoting: assigned engineer, due date, linked drawing output — same shape, just owned by Design once it exists as a module.
- A design task can require an R&D calculation (braking, load distribution, etc.) before a drawing is released — link `rnd.calculation_history` records to the relevant drawing.

## Phase 9 — Search, Tagging & Compliance

- Search across drawings by number, project, part number, material, revision.
- Railway/RDSO approval tracking per drawing where third-party approval is required — approval reference, date, approving authority. Ties into the Quality and Service & Commissioning departments' inspection needs already noted in the master roadmap.

## Phase 10 — Dashboard & Reporting

- Open review queue, drawings pending release, ECNs in progress, designer workload.
- BOM cost roll-up once Purchase/Accounts costing exists, so design choices are visible in cost terms, not just engineering terms.

## Cross-cutting

- Share the `engineering_documents`/`engineering_document_files` schema with Electrical and Fluids via the `discipline` column — build once, not three times.
- Register `design` in `AVAILABLE_APPS` (or the DB-backed module registry, once that exists per the master roadmap).
- No new storage plumbing — SharePoint attachment pattern handles every file type here, native CAD included.

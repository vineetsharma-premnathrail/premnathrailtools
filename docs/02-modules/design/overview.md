# Design Module — Overview

**Module:** Design
**Backend Location:** `backend/app/modules/design/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

The Design module is PremnathRail's engineering document repository: drawings, bills of material, engineering change notes, specification sheets, and similar formal documents raised against a specific Project, with proper version and revision control rather than files being emailed around or overwritten in place on a shared drive. It is deliberately built as one shared document table rather than a separate schema per engineering discipline — the same `EngineeringDocument` model and routes serve Design, Electrical, Fluids, and R&D disciplines, distinguished only by a `discipline` column, so that document versioning, revision history, and the status workflow are written and maintained once rather than duplicated three or four times over.

The core model is `EngineeringDocument` (`backend/app/modules/design/models/engineering_document.py`), and its routes live in `backend/app/modules/design/routes/engineering_documents.py`, mounted at `/design/documents`.

---

# 2. Discipline, Document Type, and Version

Every document belongs to exactly one **discipline** — `mechanical`, `electrical`, `fluids`, or `rnd` — and exactly one **document type**, chosen from a fixed vocabulary: `ga_drawing`, `part_drawing`, `bom`, `ecn`, `spec_sheet`, `wiring_diagram`, `panel_layout`, `cable_schedule`, `circuit_diagram`, `datasheet`, `test_certificate`, `report`. This vocabulary deliberately spans more than one department's document types in a single list — wiring diagrams and cable schedules sit alongside GA drawings and BOMs — because it is the same underlying table serving Electrical and R&D documents as well as Design's own.

Each document also carries a **title** and a **version** number, always scoped to the combination of project, discipline, document type, and title. Uploading a new version of an existing document (`supersedes_id` in the upload payload) automatically:

- Looks up the document being superseded and increments its version by one for the new upload.
- Marks the superseded document's status as `superseded` and links it forward (`superseded_by_id`) to the new version, so the chain from any historical revision to its current replacement can always be walked forward.

A document listing can be filtered to `latest_only`, which keeps only the highest-version document within each (project, discipline, document type, title) group — a practical "current revision" view for a document list, so a user browsing a project's documents by default sees only what's current rather than every historical version mixed in.

---

# 3. Revision History

A dedicated route (`GET /design/documents/{document_id}/revisions`) returns every sibling version of a given document — every row sharing the same project, discipline, document type, and title — ordered newest version first, giving a full audit-style view of how a specific drawing or BOM has evolved over time, distinct from the `latest_only` filtered list view described above.

---

# 4. Status Workflow

Every document carries a status from a fixed, five-step vocabulary: `draft → under_review → approved → released → superseded`. A document starts life as `draft` on upload and is moved through the workflow explicitly via `PATCH /design/documents/{document_id}/status`; the `superseded` status is the one exception that is set automatically, by the system itself, the moment a newer version supersedes it, rather than requiring a manual status change on the outgoing version.

---

# 5. Storage and the Backend-Proxied `/content` Route

Documents are stored in SharePoint through the same shared Microsoft Graph integration the rest of the portal uses (see [Microsoft Graph Integration](../../05-integration/microsoft-graph.md)), uploaded into a per-user, per-project folder path built by `build_sharepoint_folder_path`. The upload route requires `SHAREPOINT_SITE_ID` to be configured and returns `503` if it isn't.

This session added a backend-proxied content route, `GET /design/documents/{document_id}/content`, closing a gap where Design was the one remaining place in the portal still capable of exposing a raw SharePoint link. The route fetches the file's bytes server-side using the application's own app-only Graph token and serves them from the application's own origin — with the module-access check enforced before any bytes are returned — rather than handing the browser a SharePoint URL directly. This brings Design in line with the same principle already applied to ERP, P2P, and CRM attachments: the frontend never receives a `sharepoint_url` it could act on directly, only a backend endpoint whose access is checked by the application's own authorization logic every time it is called. The `sharepoint_url` column still exists on the model for internal record-keeping, but it is not exposed by the endpoint.

---

# 6. Access Model

Every route in this module requires `require_app_access("design")`, with no further granular permission distinction between listing, uploading, or changing a document's status — any user with Design module access can perform any of these actions. There is no per-record ownership restriction analogous to ERP's creator-plus-permission-string model; this mirrors the simpler, whole-module-access approach used by CRM, Purchase, and R&D.

---

# 7. What This Module Does Not Do

- The Design module does not implement its own file storage — every document lives in SharePoint via the shared Graph integration, and, as of this session's fix, is never served to the browser as a raw SharePoint link.
- The module has no approval-routing or sign-off workflow beyond the flat status field described above — moving a document from `under_review` to `approved` is a direct status change, not a multi-step approval chain with named approvers.
- The shared `EngineeringDocument` table currently only distinguishes discipline by a plain string column; it does not yet carry a dedicated route namespace for Electrical or Fluids documents beyond what the Design module's own routes already expose.

---

# 8. Related Documentation

- [Microsoft Graph Integration](../../05-integration/microsoft-graph.md) — the SharePoint upload, validation, and backend-proxied content-serving mechanism this module is built on.
- [Electrical Module Overview](../electrical/overview.md) — a sibling discipline sharing this same document table.
- [R&D Module Overview](../rnd/overview.md) — the calculation-tool module whose report exports are a separate mechanism from this module's document repository.

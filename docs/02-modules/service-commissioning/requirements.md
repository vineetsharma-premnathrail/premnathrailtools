# Service & Commissioning — Functional Requirements

**Module:** Service & Commissioning
**Backend Location:** `backend/app/modules/erp/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This document sets out the functional requirements of the Service & Commissioning module, as they exist in the current implementation. Each requirement below is traceable to a real backend route in `backend/app/modules/erp/routes/projects.py` or `backend/app/modules/erp/routes/service_requests.py`, and to the corresponding page under `frontend/src/app/dashboard/erp/`. Requirements are grouped by the two entities the module is built around: the machine registry (Projects) and the service ticket lifecycle (Service Requests), with a further group for the Materials sub-flow that lives inside a Service Request.

Where earlier scoping documents (`old_docs/requirements/FUNCTIONAL_REQUIREMENTS.md`, `old_docs/product/SCOPE_DOCUMENT.md`) described a requirement that has since been superseded or corrected by this session's work, this document reflects the corrected, current behavior rather than the historical description.

---

# 2. Machine / Project Registry Requirements

1. **REQ-1 — Register a machine.** A user with ERP access and the `project_create` permission can register a new machine/asset ("Project") with a unique serial number. Duplicate serial numbers are rejected outright at the API level (`POST /erp/projects`).
2. **REQ-2 — List and search machines.** All users with ERP access can list active (non-deleted) machines, filter by status, application type, or client company, and free-text search across serial number, model, and client company (`GET /erp/projects`). The list is sorted using a natural sort on the serial number so that, for example, `PEW-53-A-9` sorts before `PEW-53-A-10`.
3. **REQ-3 — View and edit machine detail.** Any ERP user can view a single machine's full detail. Editing requires the `project_edit` permission (`GET/PATCH /erp/projects/{id}`).
4. **REQ-4 — Filter option discovery.** The registry list page can populate its filter dropdowns from the actual distinct values present in the data, rather than a hardcoded list, via `GET /erp/projects/filter-options`.
5. **REQ-5 — Lifecycle date tracking.** Each machine record tracks a commissioning date, warranty start/end dates, an optional extended warranty flag and end date, a warranty override status, an AMC (Annual Maintenance Contract) status, and an AMC end date. These fields exist on the `Project` model and are surfaced on the machine detail and edit pages.
6. **REQ-6 — Soft delete and recycle bin.** A user with the `project_delete` permission can soft-delete a machine (`DELETE /erp/projects/{id}`). Deleting a machine cascades to soft-delete every non-deleted Service Request linked to it, since the ORM's cascade rules do not fire on a soft-delete flag change — this cascade is done explicitly in the route. Deleted machines appear in a recycle bin (`GET /erp/projects/recycle-bin/list`) and can be restored (`POST /erp/projects/{id}/restore`), which also restores its previously-cascaded Service Requests. Deleted records are auto-purged after 10 days.
7. **REQ-7 — Audit trail.** Every create, update, delete, and restore action against a machine is written to a shared audit log and viewable via `GET /erp/projects/{id}/audit`.
8. **REQ-8 — Document attachments.** Files can be attached to a machine, stored in SharePoint and proxied through the backend. An attachment can be marked private, in which case it is visible only to its uploader, an admin, or specific users/departments/designations it has been explicitly shared with (`GET/POST/PATCH/DELETE /erp/projects/{id}/attachments...`).

---

# 3. Service Request Requirements

1. **REQ-9 — Raise a service request.** A user with the `sr_create` permission can create a Service Request against an existing, non-deleted machine (`POST /erp/service-requests`). The request number is generated automatically in the form `SR-<financial-year>-<sequence>` (for example `SR-2026-27-0001`), with retry-on-collision logic to guarantee uniqueness even under concurrent creation.
2. **REQ-10 — List, search, and filter service requests.** All ERP users can list Service Requests, search across request number, issue title, issue description, and issue category, and filter by status, priority, or the owning project (`GET /erp/service-requests`).
3. **REQ-11 — Status and priority lifecycle.** A Service Request carries a `status` that moves through a defined sequence (see `workflows.md` for the exact sequence and the corrected list of valid values) and a `priority` of `critical`, `high`, `medium`, or `low`. Status and priority are changed through the edit endpoint (`PATCH /erp/service-requests/{id}`), which is gated by the ownership-plus-permission rule described in `permissions.md`.
4. **REQ-12 — Locking.** A Service Request can be marked `is_locked`, in which case even a user who otherwise passes the edit check is blocked from further edits (HTTP 423).
5. **REQ-13 — Diagnostics / RCA fields.** A Service Request records failure mode, root cause, and resolution description as first-class fields, surfaced in the detail page's "Diagnostics & RCA" tab.
6. **REQ-14 — Warranty and financial tracking.** Warranty claim status, claim number, and approved amount can be recorded per Service Request, alongside billing fields (service/transport/accommodation/miscellaneous cost, tax percentage, total bill, payment status, invoice number).
7. **REQ-15 — Field-level audit trail.** Every tracked field change on a Service Request (status, priority, assignment, issue detail, diagnostics, expected dates, service notes) is written to the audit log with the old and new value, viewable via `GET /erp/service-requests/{id}/audit`.
8. **REQ-16 — Soft delete and recycle bin.** A user who both created the Service Request and holds `sr_delete` (or any admin) can delete it (`DELETE /erp/service-requests/{id}`); the same rule governs restoring it from the recycle bin (`POST /erp/service-requests/{id}/restore`) — see `permissions.md` for why restore is gated identically to delete rather than to a separate "restore" permission.
9. **REQ-17 — Client notification email.** When a Service Request is created or closed, a client-facing notification email is sent as a background task, guarded so it fires at most once per event even if the background task path is ever triggered twice. Either email can be resent on demand (`POST /erp/service-requests/{id}/resend-client-email`), and a diagnostic test-email utility exists for verifying the Microsoft Graph mail configuration (`POST /erp/service-requests/test-email`).
10. **REQ-18 — Document attachments.** Files can be attached at the Service Request level (`POST /erp/service-requests/{id}/attachments`), stored in SharePoint and retrieved only through backend-proxied endpoints — never a raw SharePoint URL.

---

# 4. Materials Sub-Flow Requirements

1. **REQ-19 — Add material line items.** A user who can edit the parent Service Request can add material/spare-part line items to it, each with a name, part number, model number, description, estimated budget, reason, quantity, and unit (`POST /erp/service-requests/{sr_id}/materials`).
2. **REQ-20 — Update and delete materials.** Materials can be updated or soft-deleted under the same ownership-plus-permission rule as the parent Service Request (`PATCH/DELETE /erp/service-requests/{sr_id}/materials/{mat_id}`).
3. **REQ-21 — Raise a Purchase Requisition from unlinked materials.** A user who can edit the Service Request can raise a Purchase Requisition covering every material on that request that is not already linked to a PR (`POST /erp/service-requests/{sr_id}/raise-pr`). If no unlinked materials exist, the request is rejected with a clear error rather than silently creating an empty PR. Raising a PR requires a valid priority and, optionally, a category code and requirement type drawn from fixed lists; requester and department are always taken from the logged-in user. The Purchase department is notified in-app and by a best-effort background email.
4. **REQ-22 — Track physical receipt.** Materials can be marked received, in whole or in part (`POST /erp/service-requests/{sr_id}/materials/{mat_id}/receive`). If the material is linked to a PR, this syncs the PR item's received quantity, and once every item on the PR is fully received, the PR itself advances to a `received` status.
5. **REQ-23 — Material photos.** Photo attachments can be added to an individual material line item, restricted to image content types only (`POST /erp/service-requests/{sr_id}/materials/{mat_id}/attachments`).

---

# 5. Non-Functional Notes Relevant to This Module

- All ERP routes require `erp` module access (`require_app_access("erp")`) in addition to any granular permission check described above.
- Attachment content is never served as a raw SharePoint URL — every download/preview goes through a backend proxy endpoint (`/content`), as detailed in `api.md`.
- SharePoint-dependent endpoints return HTTP 503 rather than failing silently when `SHAREPOINT_SITE_ID` is not configured.

---

# 6. Related Documentation

- [Overview](overview.md)
- [Workflows](workflows.md) — the corrected status lifecycle
- [Permissions](permissions.md) — the exact ownership-plus-permission rule
- [API Reference](api.md)

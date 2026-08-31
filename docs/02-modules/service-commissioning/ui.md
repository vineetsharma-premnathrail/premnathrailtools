# Service & Commissioning — UI

**Module:** Service & Commissioning
**Backend Location:** `backend/app/modules/erp/`
**Frontend Location:** `frontend/src/app/dashboard/erp/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This document describes the real pages that make up the Service & Commissioning module's frontend, as they exist today, rather than as originally envisioned. It covers the list/detail/create/edit pages for both Projects (machines) and Service Requests, the Recycle Bin page, the Reports page, and the Documents/Attachments tab pattern shared by both main entities. Where a page is materially thinner than the rest of the module, that is stated plainly rather than glossed over.

---

# 2. Projects (Machines)

- **List** (`dashboard/erp/projects`) — the machine registry. Supports free-text search and filters (status, application type, client company), backed by `GET /erp/projects` and `GET /erp/projects/filter-options`. Rows are sorted using a natural sort on serial number so numeric suffixes order correctly.
- **Detail** (`dashboard/erp/projects/[id]`) — full machine record: identifying details, lifecycle dates (commissioning, warranty, extended warranty, AMC), and tabs for related Service Requests, Documents, and Audit Trail.
- **Create** (`dashboard/erp/projects/new`) — registration form, gated on `project_create`. Duplicate serial numbers are rejected with a clear error rather than a generic failure.
- **Edit** (`dashboard/erp/projects/[id]/edit`) — gated on `project_edit`. No ownership check applies here (see `permissions.md` §3) — any user with `project_edit` can edit any machine.

---

# 3. Service Requests

- **List** (`dashboard/erp/service-requests`) — searchable and filterable (status, priority, project) ticket list, backed by `GET /erp/service-requests`, sorted newest-first by creation date.
- **Detail** (`dashboard/erp/service-requests/[id]`) — the module's most feature-dense page. It renders the ten-step workflow stepper described in `workflows.md`, driven by the `WORKFLOW_STEPS` constant near the top of the file, with `cancelled` rendered as a distinct banner rather than an eleventh step. Below the stepper, the page is organized into tabs: **Overview** (issue details, status/priority editors), **Diagnostics & RCA** (failure mode, root cause, resolution), **Materials** (the sub-flow described in `workflows.md` §3, including the "Raise PR" action), **Attachments** (see §5 below), and **Audit Trail** (the full field-level change history). Clicking a non-active step in the stepper opens a confirmation dialog before applying the status change — status changes are not restricted to moving strictly forward through the sequence.
- **Create** (`dashboard/erp/service-requests/new`) — gated on `sr_create`; requires selecting an existing, non-deleted machine to attach the request to.
- **Edit** (`dashboard/erp/service-requests/[id]/edit`) — gated on the combined ownership-plus-`sr_edit` rule from `permissions.md`; also respects the `is_locked` flag, which blocks edits regardless of permission.

---

# 4. Recycle Bin

`dashboard/erp/recycle-bin` shows two sections — Deleted Projects and Deleted Service Requests — each fetched from its own recycle-bin endpoint and each carrying a "Restore" action. The Restore button's visibility is computed on the frontend as `hasErpPermission(user, 'project_delete')` for machines and `hasErpPermission(user, 'sr_delete')` for Service Requests. Note that this mirrors the backend's actual (asymmetric) rule described in `permissions.md` §4: machine restore genuinely only requires the permission string, while Service Request restore additionally requires ownership on the backend even though the frontend button here is shown to anyone with `sr_delete` — a non-owner with `sr_delete` will therefore see a Restore button that the backend will reject with a 403. This is a known rough edge to be aware of, not a fabricated one; see `testing.md` for the recommended regression test.

Deleted records display their days-remaining-before-purge count (10 days from deletion) where the API surfaces it.

---

# 5. Documents / Attachments Tab Pattern

Both the Project detail page and the Service Request detail page expose a Documents/Attachments tab built on the same underlying pattern:

1. **Upload dropzone.** Files are dragged/dropped or selected, then uploaded via a multipart POST to the entity's `/attachments` endpoint. Upload is gated behind the appropriate edit permission (`project_edit` for machines, the ownership-plus-`sr_edit` rule for Service Requests).
2. **Per-file preview.** Each uploaded file renders a thumbnail or inline preview by requesting the file's bytes through the backend's `/content` proxy endpoint (never a direct SharePoint link) — this lets an `<img>`, `<video>`, or `<embed>` tag point at the app's own origin. Formats a browser can't render natively (Office documents such as `.docx`/`.xlsx`/`.pptx`) instead use the `/preview` endpoint, which returns a short-lived Microsoft-viewer URL.
3. **Private/shared documents (Projects only).** A Project attachment can be marked private at upload time and shared with specific users, departments, or designations; `_can_view_attachment()` on the backend enforces this on every list/preview/content request, so a private document never appears in another user's attachment list even if they know its ID.
4. **Permission-gated delete.** The delete control is shown/enabled only for users who pass the relevant permission check (`project_delete` for machines; the ownership-plus-`sr_delete` rule for Service Requests), matching the backend's own gate on the delete endpoint.

---

# 6. Reports

`dashboard/erp/reports` exists and is functional, but is honestly thin as of this writing: it fetches the full Service Request list client-side and derives exactly two things from it — a "Service Requests this month" count and a status-breakdown grid (count per status value). There are no filters (by date range, project, priority, or engineer), no export, and no equivalent reporting for the machine registry. It should be treated as a placeholder pulse-check rather than a reporting tool, and any future reporting work for this module should very likely replace this page rather than extend it incrementally.

---

# 7. Related Documentation

- [Overview](overview.md)
- [Workflows](workflows.md)
- [Permissions](permissions.md)
- [API Reference](api.md)

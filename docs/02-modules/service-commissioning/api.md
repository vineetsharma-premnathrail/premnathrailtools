# Service & Commissioning — API Reference

**Module:** Service & Commissioning
**Backend Location:** `backend/app/modules/erp/routes/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This document lists every route exposed by the Service & Commissioning module's two route files, `backend/app/modules/erp/routes/projects.py` (prefix `/erp/projects`) and `backend/app/modules/erp/routes/service_requests.py` (prefix `/erp/service-requests`). Every route additionally requires `erp` module access (`require_app_access("erp")`); the permission column below lists only the *additional* granular check, if any, beyond that baseline and the ownership rule documented in `permissions.md`.

A note on the attachment-content endpoints specifically: every `/content` route was added or corrected during this session so that attachment bytes are streamed through the backend (via an app-only Microsoft Graph token) and returned as a same-origin `Response`, rather than the browser ever being handed a raw, directly-fetchable SharePoint URL. The `/preview` routes remain a deliberate exception for formats a browser cannot render natively (Office documents) — they return a short-lived Microsoft-viewer link rather than raw bytes, but that link is still minted server-side per request rather than stored or exposed as a persistent SharePoint URL.

---

# 2. Projects (Machines) — `/erp/projects`

| Method | Path | Purpose | Permission (beyond `erp` access) |
|---|---|---|---|
| GET | `/erp/projects` | List active machines, with search and status/application-type/client-company filters. | — |
| GET | `/erp/projects/filter-options` | Distinct values for the registry's filter dropdowns. | — |
| POST | `/erp/projects` | Register a new machine; rejects duplicate serial numbers. | `project_create` |
| GET | `/erp/projects/{project_id}` | Get a single machine's detail. | — |
| PATCH | `/erp/projects/{project_id}` | Update a machine's fields. | `project_edit` |
| DELETE | `/erp/projects/{project_id}` | Soft-delete a machine, cascading to its Service Requests. | `project_delete` |
| POST | `/erp/projects/{project_id}/restore` | Restore a soft-deleted machine and its cascaded Service Requests. | `project_delete` |
| GET | `/erp/projects/recycle-bin/list` | List soft-deleted machines. | — |
| GET | `/erp/projects/{project_id}/audit` | Full audit history for a machine. | — |
| GET | `/erp/projects/{project_id}/attachments` | List a machine's document attachments visible to the caller. | — (private-doc visibility enforced per-item) |
| GET | `/erp/projects/{project_id}/attachments/{attachment_id}/preview` | Short-lived Microsoft-viewer link for Office-format attachments. | — (visibility check) |
| GET | `/erp/projects/{project_id}/attachments/{attachment_id}/content` | Raw file bytes, backend-proxied, for browser-renderable formats. | — (visibility check) |
| POST | `/erp/projects/{project_id}/attachments` | Upload one or more document attachments, optionally private/shared. | `project_edit` |
| PATCH | `/erp/projects/{project_id}/attachments/{attachment_id}/permissions` | Change an attachment's private/shared visibility. | Uploader or admin only |
| DELETE | `/erp/projects/{project_id}/attachments/{attachment_id}` | Delete a document attachment (and its SharePoint file, best-effort). | `project_delete` |

---

# 3. Service Requests — `/erp/service-requests`

| Method | Path | Purpose | Permission (beyond `erp` access) |
|---|---|---|---|
| GET | `/erp/service-requests` | List Service Requests, with search and status/priority/project filters. | — |
| POST | `/erp/service-requests` | Create a Service Request against an existing machine; auto-generates the SR number. | `sr_create` |
| GET | `/erp/service-requests/recycle-bin` | List soft-deleted Service Requests, with days-remaining-before-purge. | — |
| GET | `/erp/service-requests/{sr_id}` | Get a single Service Request's detail. | — |
| PATCH | `/erp/service-requests/{sr_id}` | Update SR fields (including status/priority); blocked if `is_locked`. | Ownership + `sr_edit` |
| DELETE | `/erp/service-requests/{sr_id}` | Soft-delete a Service Request. | Ownership + `sr_delete` |
| POST | `/erp/service-requests/{sr_id}/restore` | Restore a soft-deleted Service Request. | Ownership + `sr_delete` |
| GET | `/erp/service-requests/{sr_id}/audit` | Full field-level audit history for a Service Request. | — |
| POST | `/erp/service-requests/{sr_id}/attachments` | Upload one or more attachments to the Service Request. | Ownership + `sr_edit` |
| GET | `/erp/service-requests/{sr_id}/attachments/{attachment_id}/content` | Raw file bytes, backend-proxied. | — |
| GET | `/erp/service-requests/{sr_id}/attachments/{attachment_id}/preview` | Short-lived Microsoft-viewer link for Office-format attachments. | — |
| DELETE | `/erp/service-requests/{sr_id}/attachments/{attachment_id}` | Delete an attachment. | Ownership + `sr_delete` |
| GET | `/erp/service-requests/{sr_id}/materials` | List active material line items on the Service Request. | — |
| POST | `/erp/service-requests/{sr_id}/materials` | Add a material line item. | Ownership + `sr_edit` |
| PATCH | `/erp/service-requests/{sr_id}/materials/{mat_id}` | Update a material line item. | Ownership + `sr_edit` |
| DELETE | `/erp/service-requests/{sr_id}/materials/{mat_id}` | Soft-delete a material line item. | Ownership + `sr_delete` |
| POST | `/erp/service-requests/{sr_id}/materials/{mat_id}/attachments` | Upload photo(s) to a material (image content types only). | Ownership + `sr_edit` |
| GET | `/erp/service-requests/{sr_id}/materials/{mat_id}/attachments/{attachment_id}/content` | Raw photo bytes, backend-proxied. | — |
| GET | `/erp/service-requests/{sr_id}/materials/{mat_id}/attachments/{attachment_id}/preview` | Short-lived Microsoft-viewer link for a material photo. | — |
| DELETE | `/erp/service-requests/{sr_id}/materials/{mat_id}/attachments/{attachment_id}` | Delete a material photo. | Ownership + `sr_delete` |
| POST | `/erp/service-requests/{sr_id}/raise-pr` | Raise a Purchase Requisition from the SR's unlinked materials. | Ownership + `sr_edit` |
| POST | `/erp/service-requests/{sr_id}/materials/{mat_id}/receive` | Record a (possibly partial) physical receipt of a material; syncs the linked PR. | Ownership + `sr_edit` |
| POST | `/erp/service-requests/{sr_id}/resend-client-email` | Resend the client-facing "created" or "closed" notification email. | — |
| POST | `/erp/service-requests/test-email` | Send a diagnostic test email via Microsoft Graph. | — |

---

# 4. Related Documentation

- [Overview](overview.md)
- [Permissions](permissions.md) — full explanation of the "Ownership + permission" column above
- [UI](ui.md)
- [../../05-integration/](../../05-integration/) — SharePoint integration detail

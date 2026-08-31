# Service & Commissioning (ERP) — Overview

Machine/asset registry plus the full field-service lifecycle against those machines.

**Backend:** `backend/app/modules/erp/` · **Frontend:** `frontend/src/app/dashboard/erp/`

**Sub-applications inside this module:**
1. **Projects (Machines)** — asset registry with lifecycle dates (warranty, AMC, commissioning), recycle bin + restore, audit trail, document attachments (with per-file private/share support).
2. **Service Requests** — ticket lifecycle from report to close, workflow status stepper, RCA/diagnostics tab, audit trail.
3. **Materials** — parts requested against a Service Request, receiving tracking, can raise a Purchase Requisition directly from unlinked materials.
4. **Attachments** — SharePoint-backed file storage for both Projects and Service Requests, proxied through the backend (never a raw SharePoint URL to the browser) — see [../../05-integration/](../../05-integration/).

**Permission model:** admin bypasses everything; everyone else needs both record ownership (creator) AND the matching granular permission string (`project_edit`, `project_delete`, `sr_edit`, `sr_delete`, `project_create`, `sr_create`) — see `permissions.md` (pending) and [../../04-security/](../../04-security/).

**Known gap (as of 2026-08-29):** the Recycle Bin's Restore action and the Reports page are thinner than the rest of the module — see this session's audit notes for specifics before extending either.

# API — ERP Module (`app/modules/erp`)

**Note on naming:** there is no separate "service" module in this codebase. Service
Requests (`service_requests.py`) live inside `erp`, alongside Projects
(`projects.py`) — both are ERP sub-resources sharing the same module-level gate and the
same `erp_permissions` sub-permission scheme. Do not look for (or invent) a standalone
`purchase`-style "service" module.

All routes require `require_app_access("erp")` (module gate). Beyond that, create/edit/
delete routes additionally require the matching `erp_permissions` entry on the caller
(`project_view/create/edit/delete`, `sr_view/create/edit/delete` — see API_MAIN.md);
admins bypass every such check. Paths below are relative to `/api/v1`.

## Projects (`routes/projects.py`, prefix `/erp/projects`) — 14 routes

```
GET    /erp/projects                          List (filters: search, status, application_type,
                                               client_company, skip/limit)
GET    /erp/projects/filter-options           Distinct values for the filter dropdowns
POST   /erp/projects                          201 — requires project_create/admin. 409 on duplicate.
GET    /erp/projects/{id}                     404 if missing
PATCH  /erp/projects/{id}                     Requires project_edit/admin. 404/409 as applicable.
DELETE /erp/projects/{id}                     204, soft delete — requires project_delete/admin
POST   /erp/projects/{id}/restore
GET    /erp/projects/recycle-bin/list
GET    /erp/projects/{id}/audit
GET    /erp/projects/{id}/attachments
GET    /erp/projects/{id}/attachments/{attachment_id}/preview
GET    /erp/projects/{id}/attachments/{attachment_id}/content
POST   /erp/projects/{id}/attachments         multipart/form-data — SharePoint-backed. 503 if unconfigured.
                                               Requires project_edit/admin.
PATCH  /erp/projects/{id}/attachments/{attachment_id}/permissions   Update per-department/designation/user shares
DELETE /erp/projects/{id}/attachments/{attachment_id}   Requires project_delete/admin
```
Schemas: `ProjectResponse`, `ProjectAttachmentResponse`.

**Private attachments:** project attachments carry a share list
(`ProjectAttachmentShare` rows keyed by user id / department / designation) —
`_can_view_attachment()` gates the preview/content routes so only shared viewers (or the
uploader/admin) can fetch a given attachment's bytes.

## Service Requests (`routes/service_requests.py`, prefix `/erp/service-requests`) — 24 routes

Unlike Projects, `sr_edit`/`sr_delete` alone aren't sufficient for editing/deleting an
*existing* SR — the caller must also be its creator (or admin); creation itself
(`sr_create`) has no ownership requirement, obviously.

```
GET    /erp/service-requests                  List
POST   /erp/service-requests                  201 — requires sr_create/admin
GET    /erp/service-requests/recycle-bin
GET    /erp/service-requests/{id}
PATCH  /erp/service-requests/{id}             Requires sr_edit + creator (or admin). 423 if locked by state.
DELETE /erp/service-requests/{id}             200 (not 204) — requires sr_delete + creator (or admin)
POST   /erp/service-requests/{id}/restore
GET    /erp/service-requests/{id}/audit
POST   /erp/service-requests/{id}/attachments             multipart — SharePoint-backed; sr_edit + creator/admin
GET    /erp/service-requests/{id}/attachments/{attachment_id}/content
GET    /erp/service-requests/{id}/attachments/{attachment_id}/preview
DELETE /erp/service-requests/{id}/attachments/{attachment_id}   sr_delete + creator/admin
GET    /erp/service-requests/{id}/materials
POST   /erp/service-requests/{id}/materials               201, sr_edit + creator/admin
PATCH  /erp/service-requests/{id}/materials/{mat_id}      sr_edit + creator/admin
DELETE /erp/service-requests/{id}/materials/{mat_id}      sr_delete + creator/admin
POST   /erp/service-requests/{id}/materials/{mat_id}/attachments
GET    /erp/service-requests/{id}/materials/{mat_id}/attachments/{attachment_id}/content
GET    /erp/service-requests/{id}/materials/{mat_id}/attachments/{attachment_id}/preview
DELETE /erp/service-requests/{id}/materials/{mat_id}/attachments/{attachment_id}
POST   /erp/service-requests/{id}/raise-pr                Raises a Purchase Requisition (in the `purchase`
                                                            module — see API_PURCHASE.md) from every material
                                                            not already linked to one. 201. Requires sr_edit +
                                                            creator/admin. 400 if no unlinked materials.
                                                            Emails PURCHASE_EMAIL + notifies every Purchase-module
                                                            user in-app.
POST   /erp/service-requests/{id}/materials/{mat_id}/receive   Marks a (possibly partial) physical receipt.
                                                            sr_edit + creator/admin. Body: { received_quantity }
POST   /erp/service-requests/{id}/resend-client-email
POST   /erp/service-requests/test-email                    Requires erp module access only (no sr_* permission) —
                                                            appears to be an ops/debug utility route.
```
Schemas: `ServiceRequestResponse`, `ServiceMaterialResponse`,
`PurchaseRequisitionResponse` (cross-module — see API_PURCHASE.md).

**Note:** `/erp/service-requests/test-email` sits below the numbered SR routes and gates
only on `require_app_access("erp")`, not an `sr_*` permission — flagging as a
possibly-unintentional exception to the sub-permission scheme described above, or an
intentional ops-only utility; not resolved further here.

## Presence

Presence ("who's viewing this") is used by SR/Project detail pages but lives in the
`main` module, not `erp` — see [API_MAIN.md](./API_MAIN.md#presence-routespresencepy-prefix-presence--2-routes).

---

**Module endpoint count: 38** (Projects 14, Service Requests 24).

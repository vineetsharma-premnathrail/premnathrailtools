# Functional Requirements

Each requirement is traceable to a real backend route and/or frontend page. See [SRS.md](SRS.md) for actors and system context.

Legend: **FR-\<MODULE\>-\<N\>**.

## 1. ERP / Service Module

Backend: `backend/app/modules/erp/routes/{projects,service_requests}.py`. Frontend: `frontend/src/app/dashboard/erp/**`.

| ID | Requirement | Route(s) / Page(s) |
|---|---|---|
| FR-ERP-1 | Users with ERP access can create, list, view, and edit Projects. | `POST/GET /projects`, `GET/PATCH /projects/{id}`; `dashboard/erp/projects`, `.../[id]`, `.../[id]/edit`, `.../new` |
| FR-ERP-2 | Projects can be soft-deleted and restored via a recycle bin; users with `project_delete` permission can delete. | `DELETE /projects/{id}`, `GET /projects/recycle-bin/list`, `POST /projects/{id}/restore`; `dashboard/erp/recycle-bin` |
| FR-ERP-3 | Every change to a Project is recorded and viewable as an audit trail. | `GET /projects/{id}/audit` |
| FR-ERP-4 | Files can be attached to a Project, stored in SharePoint, with per-attachment sharing permissions (public vs. restricted). | `GET/POST/PATCH/DELETE /projects/{id}/attachments...`, `PATCH .../attachments/{aid}/permissions` |
| FR-ERP-5 | Users can create, list, view, and edit Service Requests (SRs), each linked to a Project. | `POST/GET /service-requests`, `GET/PATCH /service-requests/{id}`; `dashboard/erp/service-requests` |
| FR-ERP-6 | An SR carries a `status` (open, acknowledged, assigned, scheduled, in_progress, pending_parts, on_hold, work_completed, review, closed, cancelled) and `priority` (critical, high, medium, low), settable via edit. **Note:** these value sets are defined only in the frontend (`frontend/src/types/index.ts`); the backend accepts any string — see [SRS.md §5](SRS.md#5-constraints). | `PATCH /service-requests/{id}`; `dashboard/erp/service-requests/[id]/edit` |
| FR-ERP-7 | SRs can be soft-deleted/restored via recycle bin, with full audit history. | `DELETE /service-requests/{id}`, `GET /service-requests/recycle-bin/list`, `POST .../restore`, `GET /service-requests/{id}/audit` |
| FR-ERP-8 | Users can add, edit, and delete material line items on an SR, each independently trackable for physical receipt (`receiving_status`: pending/partial/received). | `GET/POST /service-requests/{sr_id}/materials`, `PATCH/DELETE .../materials/{mat_id}`, `POST .../materials/{mat_id}/receive` |
| FR-ERP-9 | A Purchase Requisition can be raised directly from an SR's material list, handing off to the Purchase module. | `POST /service-requests/{sr_id}/raise-pr` |
| FR-ERP-10 | Files can be attached at both the SR level and the individual material level. | `.../service-requests/{id}/attachments...`, material-level attachment endpoints in `service_requests.py` |
| FR-ERP-11 | SRs support client-facing notification emails, resendable on demand, plus a test-email utility for admins. | `POST /service-requests/{id}/resend-client-email`, `POST /service-requests/test-email` |
| FR-ERP-12 | Warranty details (status, claim number/status, approved amount) can be tracked per SR. | fields on `ServiceRequest` model (`erp/models/service_request.py`); surfaced in SR detail/edit pages |
| FR-ERP-13 | SR financials (service/transport/accommodation/misc cost, tax %, total bill, payment status, invoice number) can be recorded per SR. | `ServiceRequest` model fields; SR detail/edit pages |
| FR-ERP-14 | Filterable options (e.g. for dropdowns) are available for both Projects and Service Requests list views. | `GET /projects/filter-options`, equivalent on service-requests |
| FR-ERP-15 | An ERP reports view is available to summarize project/SR data. | `dashboard/erp/reports` |

## 2. CRM Module

Backend: `backend/app/modules/crm/routes/*.py`. Frontend: `frontend/src/app/dashboard/crm/**`.

| ID | Requirement | Route(s) / Page(s) |
|---|---|---|
| FR-CRM-1 | Users can create, list, view, edit Organizations, and search by name. | `routes/organizations.py`; `dashboard/erp/crm/organizations` (see note below) |
| FR-CRM-2 | An Organization's detail view surfaces its related inquiry and tender counts. | `GET /organizations/{id}/detail` |
| FR-CRM-3 | Organizations support soft-delete, restore, recycle bin, and audit trail. | soft-delete/restore/recycle-bin/audit endpoints in `organizations.py` |
| FR-CRM-4 | Contacts are managed as nested resources under an Organization, plus a flat "all contacts" listing. | `GET/POST /organizations/{org_id}/contacts`, `PATCH/DELETE .../contacts/{contact_id}`, `GET /contacts/all` |
| FR-CRM-5 | Users can create, list, view, edit Inquiries (leads), each tracked through a stage history log. | `routes/inquiries.py`; `POST/GET /inquiries/{id}/stages`; `dashboard/crm/inquiries` |
| FR-CRM-6 | Inquiries support soft-delete, restore, recycle bin, and audit trail, matching the Organizations pattern. | soft-delete/restore/recycle-bin/audit in `inquiries.py` |
| FR-CRM-7 | Minutes of Meeting (MoM) documents can be generated from an Inquiry in DOCX or PDF format. | `POST /inquiries/{id}/mom-docx`, `POST /inquiries/{id}/mom-pdf` |
| FR-CRM-8 | Users can create, list, view, edit Tenders (deals), with the same stage-history, soft-delete/restore/recycle-bin/audit capabilities as Inquiries. | `routes/tenders.py`; `dashboard/crm/tenders` |
| FR-CRM-9 | Tender records capture tender-specific fields: authority, portal, type, category, publish/pre-bid/submission/opening dates, awarded-to, LOI number. | `crm/models/tender.py` |
| FR-CRM-10 | CRM Activities (with MoM items and attachments) can be logged against CRM entities. | `routes/activities.py`; `dashboard/crm/activities` |
| FR-CRM-11 | Free-text Notes can be attached to CRM entities. | `routes/notes.py`; `dashboard/crm/notes` |
| FR-CRM-12 | Documents can be uploaded and stored (SharePoint-backed) against any CRM entity via a generic `related_module`/`related_id` link. | `routes/documents.py` |
| FR-CRM-13 | CRM records can be bulk-imported. | `routes/bulk_import.py`; `dashboard/crm/import` |
| FR-CRM-14 | A CRM dashboard/demand summary view is available. | `routes/dashboard.py`; `dashboard/crm/demand` |
| FR-CRM-15 | CRM entities support a defined workflow-transition mechanism (`routes/workflow.py`). | `routes/workflow.py` |

## 3. R&D Module (Engineering Calculators)

Backend: `backend/app/modules/rnd/routes/{calculations,history}.py` and `tools/*`. Frontend: `frontend/src/app/dashboard/rnd/**`.

| ID | Requirement | Route(s) / Page(s) |
|---|---|---|
| FR-RND-1 | Users can run a braking-performance calculator. | `/tools/braking`; `dashboard/rnd/braking` |
| FR-RND-2 | Users can run a hydraulic-system calculator. | `/tools/hydraulic`; `dashboard/rnd/hydraulic` |
| FR-RND-3 | Users can run a Qmax calculator. | `/tools/qmax`; `dashboard/rnd/qmax` |
| FR-RND-4 | Users can run a load-distribution calculator. | `/tools/load-distribution`; `dashboard/rnd/load-distribution` |
| FR-RND-5 | Users can run a tractive-effort calculator. | `/tools/tractive-effort`; `dashboard/rnd/tractive-effort` |
| FR-RND-6 | Users can run a vehicle-performance calculator. | `/tools/vehicle-performance`; `dashboard/rnd/vehicle-performance` |
| FR-RND-7 | Users can run a spline calculator. | `/tools/spline`; `dashboard/rnd/spline` |
| FR-RND-8 | Past calculations are retained and viewable as history. | `routes/history.py`; `dashboard/rnd/history` |

## 4. Purchase Module (SR-tied Purchase Requisitions)

Backend: `backend/app/modules/purchase/{routes/purchase_requisitions.py,service.py,models/purchase_requisition.py}`. Frontend: `frontend/src/app/dashboard/purchase/**`.

| ID | Requirement | Route(s) / Page(s) |
|---|---|---|
| FR-PUR-1 | A PR is created only by raising it from an SR's materials (see FR-ERP-9) — the Purchase module does not offer independent PR creation. | `POST /service-requests/{sr_id}/raise-pr` |
| FR-PUR-2 | PRs move through the fixed lifecycle: `submitted → approved → po_raised → partially_received → received → closed`, with `rejected` (from submitted) and `cancelled` (from approved/po_raised) as terminal alternates. | `purchase/models/purchase_requisition.py` lifecycle comment + `PR_STATUSES` |
| FR-PUR-3 | Authorized users can approve, reject, or cancel a PR. | `POST /{pr_id}/approve`, `/reject`, `/cancel` |
| FR-PUR-4 | `partially_received`/`received` statuses are derived automatically as SR materials are marked received — not directly settable via API. | sync logic (`_sync_material_pr_fields`) in `routes/purchase_requisitions.py` |
| FR-PUR-5 | A `closed` PR requires prior `received` status; closing is an explicit action. | `POST /{pr_id}/close` |
| FR-PUR-6 | Individual PR line items can be updated (e.g. vendor/PO detail per item). | `PATCH /{pr_id}/items/{item_id}` |
| FR-PUR-7 | Each PR carries priority (low/medium/high), category code, requirement type, required-by date, purchase reason, and an approver. | `PurchaseRequisition` model fields |
| FR-PUR-8 | PR changes are audit-logged. | `GET /{pr_id}/audit` |
| FR-PUR-9 | The Purchase module UI also surfaces RFQs, Orders, GRNs (goods-receipt notes), Invoices, and Vendors views tied to the PR pipeline. | `dashboard/purchase/{rfqs,orders,grn,invoices,vendors}` |

## 5. Purchase Requisition Module (standalone)

Backend: `backend/app/modules/p2p/{routes/p2p_requests.py,models/p2p_request.py}`. Frontend: `frontend/src/app/dashboard/p2p/**`.

| ID | Requirement | Route(s) / Page(s) |
|---|---|---|
| FR-PRQ-1 | Any user with `p2p` app access can create a standalone PR request directly, independent of any Service Request. | `POST /pr-requests` (or module's create route); `dashboard/p2p/new` |
| FR-PRQ-2 | A PR request records department, requester, request date, priority, category, requirement type, required-by date, and purchase reason. | `P2PRequest` model fields |
| FR-PRQ-3 | PR requests follow the same core lifecycle as the SR-tied module (`submitted → approved → po_raised → partially_received → received → closed`, with `rejected`/`cancelled` alternates), defined independently via `PR_REQUEST_STATUSES`. | `p2p/models/p2p_request.py` |
| FR-PRQ-4 | A PR request can be assigned to a buyer. | `POST /pr-requests/{id}/assign-buyer` |
| FR-PRQ-5 | A buyer can request quotations, then select a vendor from a vendor comparison. | `POST /{id}/request-quotations`, `POST /{id}/select-vendor`; fields `rfq_number`, `quotation`, `quotation_date`, `vendor_comparison`, `selected_vendor` |
| FR-PRQ-6 | A Purchase Order can be created against a PR request once a vendor is selected, recording PO value. | `POST /{id}/create-po`; field `po_value` |
| FR-PRQ-7 | Goods receipt can be recorded incrementally (ordered/received quantity, receipt status, GRN number, receipt date, receiving remarks), with a computed pending-quantity. | `POST /{id}/update-receipt`; `pending_quantity` property |
| FR-PRQ-8 | A PR request can be approved, rejected (with reason), or cancelled (with reason). | `POST /{id}/approve`, `/reject`, `/cancel`; fields `rejected_reason`, `cancelled_reason` |
| FR-PRQ-9 | A PR request can be closed once fully received. | `POST /{id}/close` |
| FR-PRQ-10 | File attachments can be added to a PR request and, per the newest migration, to individual line items within it. | attachment endpoints in `p2p_requests.py`; migration `d4e8b2c7a913_add_pr_request_attachment_item_id.py` |
| FR-PRQ-11 | All PR request changes are audit-logged. | `GET /{id}/audit` |
| FR-PRQ-12 | Metadata (categories, requirement types, etc.) needed to populate the create/edit form is served from a dedicated endpoint. | `GET /pr-requests/meta` |
| FR-PRQ-13 | **This module does not currently support soft-delete/recycle-bin** — no `is_deleted` field exists on `P2PRequest`. Confirm with the team whether hard-delete is intended or delete is simply not exposed. | — (gap, not a route) |

## 6. Users / Admin Module

Backend: `backend/app/modules/main/{routes/{auth,users,notifications}.py,models/user.py}`. Frontend: `frontend/src/app/dashboard/users`.

| ID | Requirement | Route(s) / Page(s) |
|---|---|---|
| FR-ADM-1 | Users authenticate exclusively via Microsoft SSO (Entra ID); there is no username/password login. | `GET /microsoft-login`, `GET /callback`, `POST /teams-token`, `POST /teams-exchange`, `GET /me`, `POST /logout` |
| FR-ADM-2 | Admins can view and manage the full user list, including each user's role, assigned apps, and ERP permissions. | `dashboard/users`; `main/routes/users.py` |
| FR-ADM-3 | A user's effective module access (`apps`) is `assigned_apps` for regular users, and all five modules automatically for admins. | `User.get_apps()` (`main/models/user.py`) |
| FR-ADM-4 | ERP-specific actions (e.g. deleting a project, viewing certain SR fields) are gated by fine-grained `erp_permissions`, checked identically on the client (`hasErpPermission`) and expected to be enforced server-side. | `frontend/src/hooks/useAuth.ts`; ERP route permission checks |
| FR-ADM-5 | In-app notifications are created for relevant events and also pushed to Microsoft Teams' activity feed via Graph API. | `backend/app/utils/notifications.py`, `main/routes/notifications.py` |
| FR-ADM-6 | Every auditable entity (Projects, SRs, Organizations, Inquiries, Tenders, PR Requests) exposes a `GET /{id}/audit` endpoint backed by a shared `AuditLog` table. | `main/models/audit_log.py` |

See also: [USER_STORIES.md](USER_STORIES.md), [USE_CASES.md](USE_CASES.md), [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md).

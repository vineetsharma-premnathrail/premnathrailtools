# API — CRM Module (`app/modules/crm`)

All routes require `require_app_access("crm")` (module-level: `assigned_apps` contains
`"crm"`; admins always pass). Mutating routes (`PATCH`/`DELETE`) on Organizations,
Inquiries, Tenders, Activities, Notes, and Documents additionally require the caller be
the record's creator, or an admin (`_can_modify()` helper repeated per-router) — `403`
otherwise. CRM has no granular sub-permission list (unlike ERP) — it's whole-module
access only.

Paths below are relative to `/api/v1`.

## Organizations (`routes/organizations.py`, prefix `/crm/organizations`) — 15 routes

```
GET    /crm/organizations                 List (filters: search, railway_zone)
GET    /crm/organizations/search-name?q=  Live duplicate-name lookup, top 10 matches
GET    /crm/organizations/contacts/all    All org contacts across every org
POST   /crm/organizations                 Create — 409 on duplicate name or GST number
GET    /crm/organizations/{id}
GET    /crm/organizations/{id}/detail     Includes contacts[], inquiry_count, tender_count
PATCH  /crm/organizations/{id}
DELETE /crm/organizations/{id}            Soft delete (204), cascades to its Inquiries/Tenders
POST   /crm/organizations/{id}/restore
GET    /crm/organizations/recycle-bin/list
GET    /crm/organizations/{id}/audit
GET    /crm/organizations/{id}/contacts
POST   /crm/organizations/{id}/contacts
PATCH  /crm/organizations/{id}/contacts/{contact_id}
DELETE /crm/organizations/{id}/contacts/{contact_id}
```
Schemas: `OrganizationResponse`, `OrganizationDetailResponse`, `OrgContactResponse`.

## Inquiries (`routes/inquiries.py`, prefix `/crm/inquiries`) — 13 routes

```
GET    /crm/inquiries                     List (filters: search, status, org_id)
POST   /crm/inquiries                     201 — auto-generates universal_id: INQ-YYYYMMDD-####
GET    /crm/inquiries/{id}
PATCH  /crm/inquiries/{id}                Changing current_stage auto-logs a stage entry + notification
DELETE /crm/inquiries/{id}                204
POST   /crm/inquiries/{id}/restore
GET    /crm/inquiries/recycle-bin/list
GET    /crm/inquiries/{id}/audit
GET    /crm/inquiries/{id}/stages         Full stage-change timeline — StageLogResponse[]
POST   /crm/inquiries/{id}/stages         Manually append a stage entry (also updates current_stage), 201
POST   /crm/inquiries/{id}/mom-docx       Export a Minutes-of-Meeting as .docx
POST   /crm/inquiries/{id}/mom-pdf        Export a Minutes-of-Meeting as PDF
```
Schema: `InquiryResponse`. Stage vocabulary (`current_stage`, forward-only, 15 steps):
`Customer Requirement → Design → R&D → Costing → Management Approval → Quotation
Submission → Purchase Order → Project → Manufacturing → Inspection → Dispatch →
Installation → Commissioning → Warranty → Service`.

## Tenders (`routes/tenders.py`, prefix `/crm/tenders`) — 10 routes

```
GET    /crm/tenders                       List (filters: search, status, org_id)
POST   /crm/tenders                       201 — auto-generates universal_id: TND-YYYYMMDD-####
                                           409 if tender_number+railway_zone+division already exists
                                           422 on other validation issues
GET    /crm/tenders/{id}
PATCH  /crm/tenders/{id}
DELETE /crm/tenders/{id}                  204
POST   /crm/tenders/{id}/restore
GET    /crm/tenders/recycle-bin/list
GET    /crm/tenders/{id}/audit
GET    /crm/tenders/{id}/stages
POST   /crm/tenders/{id}/stages           201
```
Schema: `TenderResponse`. Stage vocabulary (12 steps): `Tender Published → Documents
Downloaded → Participate Decision → Design Started → Costing Completed → Technical
Offer Prepared → Commercial Offer Prepared → Management Approval → Bid Submitted →
Technical Qualified → Financial Opened → Awarded / Lost`.

## Activities & Notes

### Activities (`routes/activities.py`, prefix `/crm/activities`) — 6 routes

```
GET    /crm/activities                              Filters: search, status, org_id, related_module, related_id
GET    /crm/activities/team-members
POST   /crm/activities                              201
PATCH  /crm/activities/{id}
POST   /crm/activities/{id}/attachments             multipart "files" (image/* only). Creator/admin only. 503 if SharePoint unconfigured.
DELETE /crm/activities/{id}/attachments/{attachment_id}   Creator/admin only.
DELETE /crm/activities/{id}
```
Schema: `ActivityResponse`, enriched (route-computed, not stored) with `contact_names`,
`related_label`, `attachments` — see `_enrich()` in `routes/activities.py`.

The `org_id` filter on `GET /crm/activities` also matches activities logged against any
Inquiry/Tender that *currently* belongs to that org, not just activities whose own
`org_id` snapshot says so (see `../architecture/` for the full explanation, if present).

**Follow-up reminders:** an Activity with `next_followup` set and `status: "Open"` gets
an in-app notification one day before and on the day itself, via a daily 8:00 AM IST
APScheduler job (`app/tasks/followup_reminders.py`, registered in `main.py`) — not
instant on save.

### Notes (`routes/notes.py`, prefix `/crm/notes`) — 4 routes

```
GET    /crm/notes     Filters: search, org_id, related_module, related_id
POST   /crm/notes     201
PATCH  /crm/notes/{id}
DELETE /crm/notes/{id}
```
Schema: `NoteResponse`.

## Documents (`routes/documents.py`, prefix `/crm/documents`) — 3 routes, SharePoint-backed

Reuses the same SharePoint integration as ERP's project/service-request attachments.
Every route `503`s with `{"detail": "SharePoint site is not configured"}` if
`SHAREPOINT_SITE_ID` isn't set.

```
GET    /crm/documents?related_module=inquiry&related_id=42
       Optional: related_sub_module, related_sub_id

POST   /crm/documents          multipart/form-data
       Fields: related_module*, related_id*, folder_type* ("client"|"internal"),
               doc_category, related_sub_module, related_sub_id, universal_id, org_id,
               description, files* (one or more). Returns list[CrmDocumentResponse].

DELETE /crm/documents/{id}     Best-effort SharePoint delete (logged, non-fatal), then soft-deletes the DB row. Creator/admin only (403 otherwise).
```
`doc_category` options: `RFQ, Tender Notice, BOQ, Technical Specifications, Drawings,
Cost Sheet, Quotation, Purchase Documents, Approval Documents, Other`.

## Workflow sub-entities (`routes/workflow.py`, prefix `/crm`) — 28 routes

Nested under their parent Inquiry/Tender; every route uses
`Depends(require_app_access("crm"))` directly (module gate only — no separate
ownership check function was found wired into these, unlike Organizations/Inquiries/
Tenders/Activities/Notes/Documents above; **Note:** if per-record ownership is enforced
for these it isn't visible in `workflow.py` itself — treat mutation access here as
whole-module rather than assuming creator-only until confirmed).

```
GET/POST     /crm/inquiries/{id}/tasks
PATCH/DELETE /crm/inquiries/{id}/tasks/{task_id}
GET/POST     /crm/tenders/{id}/tasks
PATCH/DELETE /crm/tenders/{id}/tasks/{task_id}

GET/POST     /crm/inquiries/{id}/approvals
PATCH/DELETE /crm/inquiries/{id}/approvals/{approval_id}
             Setting status to Approved/Rejected auto-stamps approved_by_id/name/approved_at

GET/POST     /crm/inquiries/{id}/quotations
PATCH/DELETE /crm/inquiries/{id}/quotations/{quot_id}

GET/POST     /crm/inquiries/{id}/purchase-orders
GET/POST     /crm/tenders/{id}/purchase-orders
PATCH/DELETE /crm/purchase-orders/{po_id}

GET/POST     /crm/tenders/{id}/competitors
PATCH/DELETE /crm/tenders/{id}/competitors/{comp_id}

GET/POST     /crm/inquiries/{id}/discussions
GET/POST     /crm/tenders/{id}/discussions
```
Schemas: `InquiryTaskResponse`, `TenderTaskResponse`, `InquiryApprovalResponse`,
`QuotationResponse`, `PurchaseOrderResponse`, `TenderCompetitorResponse`,
`DiscussionResponse`.

**Naming note:** these `purchase-orders` (`CrmDiscussion`'s sibling `PurchaseOrder`
model) are a CRM sub-entity recording a client's PO against an Inquiry/Tender — entirely
separate from the `purchase` and `p2p` modules' internal procurement
requisitions. Don't conflate them.

## Dashboard (`routes/dashboard.py`, prefix `/crm/dashboard`) — 1 route

```
GET /crm/dashboard
```
Returns `total_organizations`, `total_inquiries`, `total_tenders`, `open_followups`
(Activity status=Open), `overdue_followups` (Open + next_followup < today),
`today_activities`, `pending_tenders` (status in Active/Submitted),
`recent_notes_count`, plus `recent_organizations`/`recent_inquiries`/`recent_tenders`
(last 5 each). Schema: `CrmDashboardResponse`.

## Bulk Import (`routes/bulk_import.py`, prefix `/crm/admin/import`) — 4 routes, admin-only

Has its own local `require_admin` (distinct function object from `main/routes/users.py`'s,
same check: `role == "admin"`).

```
POST /crm/admin/import/organizations
POST /crm/admin/import/inquiries
POST /crm/admin/import/tenders
POST /crm/admin/import/activities
```
CSV upload endpoints; each parses the file, resolves/creates related records (contacts,
owning user by email), and bulk-creates rows with auto-generated universal IDs.

---

**Module endpoint count: 84** (Organizations 15, Inquiries 13, Tenders 10, Activities 6,
Notes 4, Documents 3, Workflow 28, Dashboard 1, Bulk Import 4).

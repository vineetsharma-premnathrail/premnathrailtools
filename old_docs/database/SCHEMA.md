# Schema Reference

Column-level reference for every table, grouped by module. Derived directly from the SQLAlchemy models under `backend/app/modules/*/models/*.py` (as of 2026-08-14), cross-checked against `backend/alembic/versions/*.py`. See [`ER_DIAGRAM.md`](./ER_DIAGRAM.md) for visual relationships and [`RELATIONSHIPS.md`](./RELATIONSHIPS.md) for FK cardinality prose.

Two mixins recur throughout (`backend/app/db/mixins.py`) and are noted per-table rather than repeated in full:
- **TimestampMixin** → `created_at` (`DateTime(timezone=True)`, `server_default=now()`), `updated_at` (same, `onupdate=now()`)
- **SoftDeleteMixin** → `is_deleted` (`Boolean`, default `False`, not nullable), `deleted_at` (`DateTime(timezone=True)`, nullable)

Table count found: **35 tables** across 6 modules (main, erp, crm, purchase, p2p, rnd).

---

## main module (`backend/app/modules/main/models/`)

### `users`
Portal user account; sole source of identity and role/app authorization. Auth is Microsoft SSO only.
Mixins: TimestampMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| email | String | no | — | unique, indexed; login identity |
| name | String | no | — | Display name |
| azure_id | String | yes | — | unique; Microsoft SSO subject id |
| role | String | no | `"user"` | `"admin"` bypasses `assigned_apps` entirely |
| is_active | Boolean | no | `True` | Soft-disable a user account |
| designation | String | yes | — | Job title, used for attachment-share matching |
| department | String | yes | — | Department, used for attachment-share matching |
| phone | String | yes | — | Contact number |
| assigned_apps | JSON (list[str]) | no | `[]` | Modules this user can see (non-admins) |
| erp_permissions | JSON (list[str]) | no | `[]` | Fine-grained ERP permission flags |
| is_azure_admin | Boolean | no | `False` | Azure-tenant admin flag (separate from `role`) |
| hashed_password | String | yes | — | **Dormant** — no local-auth flow reads/writes it yet |
| azure_display_name | String | yes | — | Cached Graph display name |
| profile_photo_url | String | yes | — | Cached Graph profile photo URL |
| must_change_password | Boolean | no | `False` | Dormant, paired with `hashed_password` |
| dismissed_announcements | JSON (list[str]) | no | `[]` | "What's New" dismissal tracking |
| encrypted_graph_refresh_token | String | yes | — | **Not actually encrypted** despite the name — no reader/writer wired up |
| service_permissions | JSON (list[str]) | yes | — | Fine-grained Service module permission flags |

### `audit_logs`
Generic polymorphic audit trail shared across ERP entities.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| entity_type | String(100) | no | — | indexed; e.g. `"project"`, `"service_request"` |
| entity_id | Integer | yes | — | Polymorphic target id, no FK |
| action | String(50) | no | — | e.g. `"created"`, `"updated"`, `"field_changed"` |
| field_name | String(100) | yes | — | Which field changed (for field-level entries) |
| old_value | Text | yes | — | Previous value, stringified |
| new_value | Text | yes | — | New value, stringified |
| summary | Text | yes | — | Human-readable one-liner |
| performed_by_id | Integer | yes | — | No FK to `users` |
| performed_at | DateTime(tz) | no | `now()` | server_default |

### `notifications`
In-app notification for a specific user, generated as a side effect of ERP events.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| user_id | Integer | no | — | indexed; no FK constraint |
| title | String(255) | no | — | Notification title |
| message | Text | no | — | Notification body |
| notification_type | String(50) | no | — | e.g. `"sr_created"`, `"sr_closed"` |
| entity_type | String(100) | yes | — | Polymorphic target type |
| entity_id | Integer | yes | — | Polymorphic target id, no FK |
| is_read | Boolean | no | `False` | Read state |
| read_at | DateTime(tz) | yes | — | When marked read |
| created_at | DateTime(tz) | no | `now()` | server_default |

### `feedback`
Free-text feedback/suggestion submitted by a user via the "Feedback" nav item, reviewed by admins.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| user_id | Integer | no | — | indexed; no FK constraint |
| message | Text | no | — | Feedback text |
| is_read | Boolean | no | `False` | Admin has reviewed it |
| read_at | DateTime(tz) | yes | — | When marked read |
| created_at | DateTime(tz) | no | `now()` | server_default |

### `api_keys`
Long-lived credential external systems use instead of a user login. Only a hash of the key is stored.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | — | Row id |
| name | String | no | — | Human label |
| key_hash | String | no | — | unique, indexed; hashed credential |
| prefix | String | no | — | Displayable prefix (e.g. `pk_live_...`) |
| allowed_apps | JSON (list[str]) | no | `[]` | Module scoping for the key |
| is_active | Boolean | no | `True` | Revocation flag |
| created_by_id | Integer | yes | — | No FK constraint |
| last_used_at | DateTime(tz) | yes | — | Usage tracking |
| created_at | DateTime(tz) | no | `now()` (client-side default) | Creation time |

---

## erp module (`backend/app/modules/erp/models/`)

### `erp_projects`
A deployed machine/vehicle/asset that Service Requests are raised against.
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| machine_type | String(100) | yes | — | Category of machine |
| model_name | String(200) | yes | — | Model name |
| serial_number | String(100) | no | — | unique, indexed; machine identity |
| engine_number | String(100) | yes | — | Engine identity |
| chassis_number | String(100) | yes | — | Chassis identity |
| application_type | String(100) | yes | — | Field-use category |
| status | String(50) | no | `"active"` | Lifecycle status |
| po_number / po_date | String(100) / Date | yes | — | Original purchase order |
| delivery_date / commissioning_date / handover_date | Date | yes | — | Deployment milestones |
| client_company / client_name / client_designation / client_email / client_phone / client_phone_alt / client_address / client_gst | mixed | yes | — | Client contact/identity block |
| site_name / site_location / site_state / site_pincode | String | yes | — | Deployment site address |
| site_country | String(100) | yes | `"India"` | — |
| zone | String(100) | yes | — | Railway zone/region |
| is_export | Boolean | no | `False` | Export-market flag |
| warranty_start_date / warranty_end_date | Date | yes | — | Warranty window |
| warranty_override | String(50) | yes | — | Manual override flag/reason |
| extended_warranty | Boolean | no | `False` | — |
| extended_warranty_end | Date | yes | — | — |
| amc_status / amc_end_date | String(50) / Date | yes | — | AMC contract state |
| operator_name / operator_phone / operator_email / operator_qualification | mixed | yes | — | Machine operator contact |
| specifications / installed_options / software_version / year_of_manufacture | mixed | yes | — | Technical detail block |
| notes / tech_notes / warranty_terms | Text | yes | — | Free text |

### `erp_project_attachments`
A file uploaded against a Project/machine; only the SharePoint pointer lives here.
Mixins: TimestampMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| project_id | Integer FK → erp_projects.id | no | — | Owning project |
| filename | String(255) | no | — | Original filename |
| content_type | String(255) | yes | — | MIME type |
| size | Integer | yes | — | Bytes |
| sharepoint_path / sharepoint_url | String(1000) | yes | — | SharePoint pointer |
| created_by_id | Integer | yes | — | No FK constraint |
| is_private | Boolean | no | `False` (server_default `"false"`) | Gate visibility via `erp_project_attachment_shares` |

### `erp_project_attachment_shares`
Grants read access to a private `erp_project_attachments` row. Each row targets exactly one of `user_id` / `department` / `designation` (app-enforced, not DB-enforced).

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| attachment_id | Integer FK → erp_project_attachments.id (ON DELETE CASCADE) | no | — | Target attachment |
| user_id | Integer FK → users.id (ON DELETE CASCADE) | yes | — | Share target if user-scoped |
| department | String(100) | yes | — | Share target if department-scoped; matched live against `users.department` |
| designation | String(100) | yes | — | Share target if designation-scoped; matched live against `users.designation` |

### `erp_service_requests`
The central service-ticket record for a Project.
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| request_number | String(50) | no | — | unique, indexed |
| project_id | Integer FK → erp_projects.id | no | — | indexed |
| issue_title | String(300) | no | — | — |
| issue_description | Text | yes | — | — |
| issue_category / sub_category | String(100) | yes | — | — |
| status | String(50) | no | `"open"` | Ticket lifecycle |
| priority | String(20) | no | `"medium"` | — |
| root_cause | Text | yes | — | — |
| failure_mode | String(200) | yes | — | — |
| warranty_status / warranty_claim_number / warranty_claim_status | mixed | yes | — | Warranty claim tracking |
| warranty_approved_amount | Float | yes | — | — |
| sla_response_hours / sla_resolution_hours | Integer | yes | — | Schema parity with legacy system; not wired into any UI/API route |
| sla_response_met / sla_resolution_met | Boolean | yes | — | Same — unused |
| first_response_at / resolution_at | DateTime(tz) | yes | — | Same — unused |
| reported_by_name / reported_by_phone / reported_by_email | mixed | yes | — | Client-side reporter contact |
| assigned_service_person_id | Integer | yes | — | indexed; no FK constraint |
| assigned_to_name | String(255) | yes | — | — |
| created_by_id | Integer | yes | — | indexed; no FK constraint |
| opened_at / closed_at | DateTime(tz) | yes | — | — |
| expected_date_to_attend / expected_completion_date | Date | yes | — | — |
| actual_date_attended / actual_completion_date | Date | yes | — | — |
| actual_service_duration_hours / downtime_hours | Float | yes | — | — |
| resolution_description / service_report_notes / preventive_actions | Text | yes | — | — |
| customer_feedback | Text | yes | — | — |
| customer_satisfaction | Integer | yes | — | — |
| customer_sign_off_name / customer_sign_off_date | String / Date | yes | — | — |
| service_cost / transport_cost / accommodation_cost / miscellaneous_cost / total_material_cost | Float | no | `0` | Cost breakdown |
| tax_percentage | Float | no | `18.0` | — |
| tax_amount / total_bill | Float | no | `0` | — |
| payment_status | String(50) | yes | — | — |
| invoice_number | String(100) | yes | — | — |
| is_locked | Boolean | no | `False` | Reserved for a future workflow-lock feature; nothing sets it yet |
| locked_by_id | Integer | yes | — | Paired with `is_locked`, also unused |
| lock_reason | String(255) | yes | — | Same |
| created_notification_sent / closed_notification_sent | Boolean | no | `False` | Idempotency guards so email/notification side effects fire at most once |

### `erp_service_materials`
A spare-part/material line item attached to a Service Request; the seam into the `purchase` module.
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| service_request_id | Integer FK → erp_service_requests.id | no | — | — |
| material_name | String(255) | no | — | — |
| part_number | String(100) | yes | — | — |
| model_number | String(100) | yes | — | added in `f9a3c6e1b8d4` |
| description | String(500) | yes | — | — |
| estimated_budget | Float | yes | — | added in `f9a3c6e1b8d4` |
| reason | String(500) | yes | — | added in `f9a3c6e1b8d4` |
| quantity | Float | no | `1` | — |
| unit | String(20) | no | `"pcs"` | — |
| is_warranty_covered | Boolean | no | `False` | — |
| phase | String(20) | no | `"expected"` | — |
| status | String(50) | yes | `"pending"` | — |
| pr_id | Integer FK → purchase_requisitions.id | yes | — | The only hard FK into the `purchase` module |
| pr_number | String(50) | yes | — | Denormalized mirror of `PurchaseRequisition.pr_number` |
| pr_status | String(30) | yes | — | Denormalized mirror, written by `purchase/routes/purchase_requisitions.py` on every PR status change |
| received_quantity | Float | no | `0` | Set by the Service user, not Purchase |
| receiving_status | String(20) | no | `"pending"` | `pending` \| `partial` \| `received` |

Note: `unit_price`/`total_price` existed briefly and were dropped in `9b88ecb3688b`; `supplier`/`availability` were dropped in `c9d4f7b2e8a1`. Neither exists on the current model.

### `erp_service_material_attachments`
A photo uploaded against a Service Material.
Mixins: TimestampMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| service_material_id | Integer FK → erp_service_materials.id | no | — | — |
| filename | String(255) | no | — | — |
| content_type | String(255) | yes | — | — |
| size | Integer | yes | — | — |
| sharepoint_path / sharepoint_url | String(1000) | yes | — | — |
| created_by_id | Integer | yes | — | No FK constraint |

### `erp_service_request_attachments`
A file uploaded against a Service Request.
Mixins: TimestampMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| service_request_id | Integer FK → erp_service_requests.id | no | — | — |
| filename | String(255) | no | — | — |
| content_type | String(255) | yes | — | — |
| size | Integer | yes | — | — |
| sharepoint_path / sharepoint_url | String(1000) | yes | — | — |
| created_by_id | Integer | yes | — | No FK constraint |

---

## crm module (`backend/app/modules/crm/models/`)

### `crm_organizations`
A customer/prospect organization.
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| name | String(255) | no | — | indexed |
| org_type / parent_org / railway_zone / division_workshop | mixed | yes | — | Classification |
| address / country / state / city / pin_code | mixed | yes | — | Address; `country` defaults `"India"` |
| gst_number | String(30) | yes | — | unique |
| official_phone / official_email / website | mixed | yes | — | — |
| created_by_id | Integer | yes | — | indexed; no FK constraint |

### `crm_org_contacts`
A contact person at an Organization.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| org_id | Integer FK → crm_organizations.id | no | — | indexed |
| name | String(255) | no | — | — |
| designation / mobile / email / department | mixed | yes | — | — |
| created_by_id | Integer | yes | — | No FK constraint |
| created_at | DateTime(tz) | no | — | Client-set, no server_default |

### `crm_inquiries`
A sales inquiry against an Organization.
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| universal_id | String(50) | no | — | unique, indexed; cross-module reference id |
| org_id | Integer FK → crm_organizations.id | no | — | indexed |
| org_contact_id | Integer FK → crm_org_contacts.id | yes | — | — |
| railway_zone / division / lead_source / bd_owner / sales_engineer | mixed | yes | — | — |
| status | String(50) | no | `"New Inquiry"` | — |
| current_stage | String(50) | no | `"Customer Requirement"` | — |
| product / product_category / product_spec | mixed | yes | — | — |
| quantity | Float | yes | — | — |
| unit | String(50) | yes | — | — |
| required_delivery_date | Date | yes | — | — |
| delivery_location / requirement_desc / detailed_requirement / inspection_req / warranty_req | mixed | yes | — | — |
| budget / expected_value | Float | yes | — | — |
| probability | Integer | yes | — | — |
| expected_order_date | Date | yes | — | — |
| priority | String(20) | no | `"Medium"` | — |
| next_followup_date / followup_priority / followup_assigned_to / followup_remarks | mixed | yes | — | — |
| created_by_id | Integer | yes | — | indexed; no FK constraint |

### `crm_inquiry_tasks`
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| inquiry_id | Integer FK → crm_inquiries.id | no | — | indexed |
| department | String(100) | no | — | — |
| task_title | String(255) | no | — | — |
| assigned_user_id / assigned_user_name | mixed | yes | — | No FK constraint |
| due_date | Date | yes | — | — |
| priority | String(20) | no | `"Medium"` | — |
| status | String(20) | no | `"Pending"` | — |
| remarks | Text | yes | — | — |
| created_by_id | Integer | yes | — | No FK constraint |

### `crm_inquiry_approvals`
No mixins.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| inquiry_id | Integer FK → crm_inquiries.id | no | — | indexed |
| approval_type | String(50) | no | — | — |
| status | String(20) | no | `"Pending"` | — |
| approved_by_id / approved_by_name | mixed | yes | — | No FK constraint |
| approved_at | DateTime(tz) | yes | — | — |
| comments | Text | yes | — | — |
| version | String(20) | no | `"1"` | — |
| created_by_id | Integer | yes | — | No FK constraint |
| created_at | DateTime(tz) | no | — | Client-set, no server_default |

### `crm_quotations`
No mixins.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| inquiry_id | Integer FK → crm_inquiries.id | no | — | indexed |
| quot_number | String(100) | yes | — | — |
| version | String(20) | no | `"V1"` | — |
| valid_until | Date | yes | — | — |
| price | Float | yes | — | — |
| delivery_time | String(150) | yes | — | — |
| payment_terms | Text | yes | — | — |
| submitted_date | Date | yes | — | — |
| customer_response | String(30) | no | `"— Awaiting —"` | — |
| notes | Text | yes | — | — |
| created_by_id | Integer | yes | — | No FK constraint |
| created_at | DateTime(tz) | no | — | Client-set |

### `crm_tenders`
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| universal_id | String(50) | no | — | unique, indexed |
| org_id | Integer FK → crm_organizations.id | no | — | indexed |
| org_contact_id | Integer FK → crm_org_contacts.id | yes | — | — |
| tender_number | String(100) | yes | — | indexed |
| tender_name / tender_authority / tender_portal / tender_type / tender_category | mixed | yes | — | — |
| tender_value | Float | yes | — | — |
| currency | String(10) | no | `"INR"` | — |
| status | String(50) | no | `"Active"` | — |
| current_stage | String(50) | no | `"Tender Published"` | — |
| railway_zone / division / workshop | mixed | yes | — | — |
| publish_date / doc_download_date / pre_bid_meeting_date / query_submission_date / submission_date / opening_date / financial_opening_date / expected_award_date | Date | yes | — | Tender calendar |
| participate | Boolean | yes | — | — |
| decision_by / decision_date / reason_no_participate | mixed | yes | — | — |
| awarded_to / loi_number / contract_value / loss_reason | mixed | yes | — | Award outcome |
| created_by_id | Integer | yes | — | indexed; no FK constraint |

### `crm_tender_tasks`
Mixins: TimestampMixin, SoftDeleteMixin. Same shape as `crm_inquiry_tasks` but keyed to `tender_id` (indexed FK → crm_tenders.id).

### `crm_tender_competitors`
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| tender_id | Integer FK → crm_tenders.id | no | — | indexed |
| competitor_name | String(255) | no | — | — |
| expected_price | Float | yes | — | — |
| remarks | Text | yes | — | — |
| created_by_id | Integer | yes | — | No FK constraint |

### `crm_purchase_orders`
No mixins.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| inquiry_id | Integer FK → crm_inquiries.id | yes | — | indexed |
| tender_id | Integer FK → crm_tenders.id | yes | — | indexed |
| org_id | Integer FK → crm_organizations.id | no | — | indexed |
| po_number | String(100) | yes | — | — |
| po_date | Date | yes | — | — |
| po_value | Float | yes | — | — |
| delivery_schedule / special_conditions | Text | yes | — | — |
| status | String(20) | no | `"Active"` | — |
| created_by_id | Integer | yes | — | No FK constraint |
| created_at | DateTime(tz) | no | — | Client-set |

### `crm_activities`
Polymorphic activity/visit log against any CRM entity.
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| activity_type | String(50) | yes | — | — |
| org_id | Integer FK → crm_organizations.id | yes | — | indexed |
| org_contact_id | Integer FK → crm_org_contacts.id | yes | — | — |
| related_module | String(30) | yes | — | Polymorphic target module, no FK |
| related_id | Integer | yes | — | Polymorphic target id, no FK |
| universal_id | String(50) | yes | — | — |
| activity_date | Date | yes | — | added in `d3f6b1c9a2e4` |
| next_followup | Date | yes | — | — |
| assigned_to | String(150) | yes | — | — |
| status | String(20) | no | `"Open"` | — |
| remarks | Text | yes | — | — |
| action_plan | Text | yes | — | added in `c4d8f2a91b6e` |
| created_by_id | Integer | yes | — | indexed; no FK constraint |
| mom_items | JSON (list) | yes | — | added in `e7a2c4d8f1b6`; ordered `{observation, action_plan, responsibility, target_date}` rows |
| contact_ids | JSON (list[int]) | yes | — | added in `f4b8d2e6c9a1`; additional attendees beyond `org_contact_id` |

Note: `subject`/`meeting_date` briefly existed from untracked schema drift and were dropped in `c4d8f2a91b6e` — see `MIGRATIONS.md`.

### `crm_activity_attachments`
No mixins besides TimestampMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| activity_id | Integer FK → crm_activities.id | no | — | indexed |
| filename | String(255) | no | — | — |
| content_type | String(255) | yes | — | — |
| size | Integer | yes | — | — |
| sharepoint_path / sharepoint_url | String(1000) | yes | — | — |
| created_by_id | Integer | yes | — | No FK constraint |

### `crm_notes`
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| org_id | Integer FK → crm_organizations.id | yes | — | indexed |
| org_contact_id | Integer FK → crm_org_contacts.id | yes | — | — |
| related_module | String(30) | yes | — | Polymorphic, no FK |
| related_id | Integer | yes | — | Polymorphic, no FK |
| universal_id | String(50) | yes | — | — |
| note | Text | no | — | — |
| created_by_name | String(150) | yes | — | — |
| created_by_id | Integer | yes | — | indexed; no FK constraint |

### `crm_documents`
File uploaded against an Inquiry/Tender.
Mixins: TimestampMixin, SoftDeleteMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| related_module | String(30) | no | — | Polymorphic, no FK |
| related_id | Integer | no | — | indexed; polymorphic, no FK |
| related_sub_module | String(30) | yes | — | Optional sub-scoping |
| related_sub_id | Integer | yes | — | — |
| universal_id | String(50) | yes | — | — |
| folder_type | String(20) | no | — | — |
| doc_category | String(100) | yes | — | — |
| file_name | String(255) | no | — | — |
| file_path | String(1000) | no | — | — |
| sharepoint_path / sharepoint_url | String(1000) | yes | — | — |
| file_size | Integer | yes | — | — |
| mime_type | String(255) | yes | — | — |
| description | Text | yes | — | — |
| uploaded_by_name | String(150) | yes | — | — |
| org_id | Integer FK → crm_organizations.id | yes | — | — |
| created_by_id | Integer | yes | — | No FK constraint |

### `crm_discussions`
No mixins.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| related_module | String(30) | no | — | Polymorphic, no FK |
| related_id | Integer | no | — | indexed; polymorphic, no FK |
| universal_id | String(50) | yes | — | — |
| message | Text | no | — | — |
| department | String(100) | yes | — | — |
| sent_by_id | Integer | no | — | No FK constraint |
| sent_by_name | String(150) | yes | — | — |
| created_at | DateTime(tz) | no | — | Client-set |

### `crm_stage_logs`
No mixins.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| related_module | String(30) | no | — | Polymorphic, no FK |
| related_id | Integer | no | — | indexed; polymorphic, no FK |
| universal_id | String(50) | yes | — | — |
| stage | String(100) | no | — | — |
| entered_by_id / entered_by_name | mixed | yes | — | No FK constraint |
| notes | Text | yes | — | — |
| created_at | DateTime(tz) | no | — | Client-set |

---

## purchase module (`backend/app/modules/purchase/models/`) — SR-raised PRs

### `purchase_requisitions`
A purchase requisition raised from a Service Request's Materials tab; deliberately loosely coupled to `erp` (see docstring).
Mixins: TimestampMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| pr_number | String(50) | no | — | unique, indexed |
| project_id | Integer FK → erp_projects.id | no | — | indexed; no ORM `relationship()` |
| service_request_id | Integer FK → erp_service_requests.id | no | — | indexed; no ORM `relationship()` |
| status | String(30) | no | `"submitted"` | See lifecycle in model docstring |
| raised_by_id | Integer FK → users.id | yes | — | — |
| priority | String(10) | no | `"medium"` | added in `e1f6a3c9b2d4`; immutable after creation |
| required_by_date | Date | yes | — | added in `e1f6a3c9b2d4` |
| purchase_reason | Text | yes | — | added in `e1f6a3c9b2d4` |
| category_code | String(10) | yes | — | added in `e7c1a9d4f256`; one of `PR_CATEGORIES` |
| requirement_type | String(50) | yes | — | added in `e7c1a9d4f256` |
| approver_id | Integer FK → users.id | yes | — | added in `e7c1a9d4f256` |
| approver_name | String(150) | yes | — | added in `e7c1a9d4f256` |
| vendor | String(255) | yes | — | — |
| po_number | String(100) | yes | — | — |
| po_date / expected_delivery_date | Date | yes | — | — |
| notes | Text | yes | — | — |
| approved_by_id | Integer FK → users.id | yes | — | — |
| approved_at | DateTime(tz) | yes | — | — |
| closed_by_id | Integer FK → users.id | yes | — | — |
| closed_at | DateTime(tz) | yes | — | — |

Note: `unit_price`/`total_price` never existed on this table's item child at this level; see `purchase_requisition_items` below for where they were dropped.

### `purchase_requisition_items`
One material line item within a `PurchaseRequisition`, snapshotted from `ServiceMaterial`. Quantity/receiving tracking only, no cost tracking.
Mixins: TimestampMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| purchase_requisition_id | Integer FK → purchase_requisitions.id | no | — | — |
| service_material_id | Integer FK → erp_service_materials.id | no | — | Snapshot source |
| material_name | String(255) | no | — | — |
| part_number | String(100) | yes | — | — |
| unit | String(20) | no | `"pcs"` | — |
| quantity_requested | Float | no | `1` | — |
| quantity_received | Float | no | `0` | — |
| item_status | String(20) | no | `"pending"` | `pending` \| `partial` \| `received` |
| remarks | String(1000) | yes | — | added in `a2d5e8f1c3b7` |

Note: `unit_price`/`total_price` were dropped in `9b88ecb3688b` (costing removed from this module).

---

## p2p module (`backend/app/modules/p2p/models/`) — standalone P2P requests

### `p2p_requests`
A standalone purchase requisition raised by any department, fully independent of `purchase.PurchaseRequisition`.
Mixins: TimestampMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| p2p_number | String(50) | no | — | unique, indexed; format `P2P-[CODE]-[YEAR]-[NUMBER]` |
| category_code | String(10) | no | — | One of `P2P_CATEGORIES` |
| project_label | String(255) | yes | — | Free-text project label (not an FK — unlike `purchase`, this module has no ERP project) |
| required_date | Date | yes | — | — |
| requirement_type | String(50) | yes | — | — |
| request_date | Date | no | — | — |
| department | String(100) | yes | — | — |
| requested_by_id | Integer FK → users.id | yes | — | — |
| priority | String(10) | no | `"medium"` | — |
| approver_id | Integer FK → users.id | yes | — | — |
| approver_name | String(150) | yes | — | — |
| remarks | Text | yes | — | — |
| status | String(30) | no | `"submitted"` | — |
| approved_by_id | Integer FK → users.id | yes | — | — |
| approved_at | DateTime(tz) | yes | — | — |
| rejected_reason / cancelled_reason | Text | yes | — | — |
| closed_by_id | Integer FK → users.id | yes | — | — |
| closed_at | DateTime(tz) | yes | — | — |
| assigned_buyer_id | Integer FK → users.id | yes | — | — |
| assignment_date | Date | yes | — | — |
| vendor / rfq_number / quotation | mixed | yes | — | — |
| quotation_date | Date | yes | — | — |
| vendor_comparison / selected_vendor | mixed | yes | — | — |
| po_number / po_date / po_value / expected_delivery | mixed | yes | — | — |
| ordered_quantity / received_quantity | Float | yes | — | — |
| receipt_status | String(20) | yes | — | — |
| grn_number | String(100) | yes | — | — |
| receipt_date / receiving_remarks | mixed | yes | — | — |

### `p2p_request_items`
One item/part line within a `P2PRequest`.
Mixins: TimestampMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| p2p_request_id | Integer FK → p2p_requests.id | no | — | — |
| item_name | String(255) | no | — | — |
| part_code | String(100) | yes | — | — |
| model_number | String(100) | yes | — | — |
| unit | String(20) | yes | — | — |
| quantity | Float | no | `1` | — |
| description | Text | yes | — | — |
| estimated_budget | Float | yes | — | — |
| reason | Text | yes | — | — |

### `p2p_request_attachments`
A file uploaded against a `P2PRequest`, optionally scoped to one line item.
Mixins: TimestampMixin.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| p2p_request_id | Integer FK → p2p_requests.id | no | — | — |
| item_id | Integer FK → p2p_request_items.id | yes | — | added in `d4e8b2c7a913` |
| doc_type | String(20) | no | `"supporting"` | `supporting` \| `specification` \| `po_document` |
| filename | String(255) | no | — | — |
| content_type | String(255) | yes | — | — |
| size | Integer | yes | — | — |
| sharepoint_path / sharepoint_url | String(1000) | yes | — | — |
| created_by_id | Integer | yes | — | No FK constraint |

---

## rnd module (`backend/app/modules/rnd/models/`)

### `rnd_calculation_history`
Cross-tool save/rename/list/delete log — one row per named save regardless of which tool produced it.

| Column | Type | Nullable | Default | Purpose |
|---|---|---|---|---|
| id | Integer PK | no | autoincrement | Row id |
| user_id | Integer | no | — | indexed; no FK constraint |
| tool_name | String(100) | no | — | indexed |
| calculation_name | String(255) | yes | — | — |
| inputs_json | JSON | no | `{}` | — |
| results_json | JSON | no | `{}` | — |
| created_at | DateTime(tz) | no | `now()` | server_default |

### `rnd_braking_calculations`, `rnd_hydraulic_calculations`, `rnd_load_distribution_calculations`, `rnd_qmax_calculations`, `rnd_spline_calculations`, `rnd_tractive_effort_calculations`, `rnd_vehicle_performance_calculations`
Per-tool denormalized snapshot tables, populated in parallel with `rnd_calculation_history` on every save so common numeric fields are directly queryable without JSON unpacking. All share the shape: `id` PK, `user_id` (indexed, no FK), `calculation_name` (nullable), a set of tool-specific float/int/string input and output columns, `inputs_json`, `results_json`, `created_at` (server_default `now()`).

Tool-specific columns (all nullable Float unless noted):

| Table | Notable columns |
|---|---|
| rnd_braking_calculations | mass_kg, reaction_time, num_wheels (Integer), calc_mode (String), mu, rail_speed_input (String), rail_gradient_input (String), rail_gradient_type (String), max_braking_force_n, gbr_percent |
| rnd_hydraulic_calculations | calc_mode (String), weight, axles (Integer), speed, pressure, wheel_diameter, slope_percent, suggested_motor_cc, suggested_pump_cc |
| rnd_load_distribution_calculations | config_type (String), total_load, front_percent, q1_percent, q3_percent, delta_q_ratio_pct, status (String) |
| rnd_qmax_calculations | d_mm, sigma_b, v_head, qmax_kn, qmax_tonnes |
| rnd_spline_calculations | doc_no (String, **indexed**), number_teeth (Integer), diametral_pitch, pressure_angle, outer_diameter, inner_diameter, length_engagement, yield_strength, material_type (String), safety_factor, verdict (String) |
| rnd_tractive_effort_calculations | mode (String), load, loco_weight, speed, gradient, grad_type (String), curvature, curvature_unit (String), te_kg, power_hp, ohe_current_a |
| rnd_vehicle_performance_calculations | loco_gvw_kg, max_speed_kmh, num_axles (Integer), rear_axle_ratio, shunting_load_t, peak_power_kw, max_traction_n, traction_no_slip_n, traction_status (String) |

The model file's docstring notes this schema existed in the legacy app but no route ever wrote to it there — in this codebase `history.save_history()` actually populates the matching table.

---

## Regarding a "service" module

`backend/app/modules/service/` **does not exist** in this codebase — there is no separate `service` module overlapping with `erp`'s service-request tables. All service-request functionality (`erp_service_requests`, `erp_service_materials`, and their attachment tables) lives under `app.modules.erp.models`. If a `service` module is added later, this doc should be revisited for a real overlap, but as of this writing there is none to document.

# Relationships

FK relationships and cardinalities across the 35 tables documented in [`SCHEMA.md`](./SCHEMA.md). See [`ER_DIAGRAM.md`](./ER_DIAGRAM.md) for the visual version. For higher-level module/service boundaries, see [`../architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md).

## Within `erp`

- **`erp_projects` 1—N `erp_service_requests`** via `service_requests.project_id`, cascade `all, delete-orphan` on the ORM side (deleting a Project deletes its Service Requests). Non-nullable FK, indexed.
- **`erp_projects` 1—N `erp_project_attachments`** via `project_id`, cascade `all, delete-orphan`.
- **`erp_project_attachments` 1—N `erp_project_attachment_shares`** via `attachment_id` (`ON DELETE CASCADE` at the DB level too), cascade `all, delete-orphan` on the ORM side.
- **`erp_project_attachment_shares` N—1 `users`** via nullable `user_id` (`ON DELETE CASCADE`). This FK is optional by design: a share row is exactly one of user-scoped, department-scoped, or designation-scoped (`department`/`designation` are plain strings with no FK, matched live against the current `users.department`/`users.designation` at read time — not a frozen membership list, per the model docstring in `erp/models/project_attachment.py`).
- **`erp_service_requests` 1—N `erp_service_materials`** via `service_request_id`, cascade `all, delete-orphan`.
- **`erp_service_requests` 1—N `erp_service_request_attachments`** via `service_request_id`, cascade `all, delete-orphan`.
- **`erp_service_materials` 1—N `erp_service_material_attachments`** via `service_material_id`, cascade `all, delete-orphan`.

## Within `crm`

- **`crm_organizations` 1—N `crm_org_contacts`** via `org_id`, cascade `all, delete-orphan`.
- **`crm_organizations` 1—N `crm_inquiries`** and **1—N `crm_tenders`** via `org_id` (non-nullable, indexed, no delete cascade declared on either child).
- **`crm_inquiries` 1—N `crm_inquiry_tasks` / `crm_inquiry_approvals` / `crm_quotations`** via `inquiry_id`, cascade `all, delete-orphan` on all three.
- **`crm_tenders` 1—N `crm_tender_tasks` / `crm_tender_competitors`** via `tender_id`, cascade `all, delete-orphan`.
- **`crm_purchase_orders` N—1 `crm_inquiries`** (nullable `inquiry_id`) and **N—1 `crm_tenders`** (nullable `tender_id`) and **N—1 `crm_organizations`** (non-nullable `org_id`) — a PO can trace back to either an Inquiry or a Tender (or neither), but always belongs to an Organization.
- **`crm_activities` 1—N `crm_activity_attachments`** via `activity_id` (non-nullable, indexed), cascade `all, delete-orphan`.
- **`crm_activities` N—1 `crm_organizations`** (nullable `org_id`) and **N—1 `crm_org_contacts`** (nullable `org_contact_id`, kept as the "primary" contact once `contact_ids` was added for multi-attendee support).
- **`crm_notes` N—1 `crm_organizations`** (nullable `org_id`) and **N—1 `crm_org_contacts`** (nullable `org_contact_id`).
- **`crm_documents` N—1 `crm_organizations`** (nullable `org_id`).

### Polymorphic associations in `crm` (no FK constraint)

`crm_activities.related_module`+`related_id`, `crm_notes.related_module`+`related_id`, `crm_documents.related_module`+`related_id`(+`related_sub_module`/`related_sub_id`), `crm_discussions.related_module`+`related_id`, and `crm_stage_logs.related_module`+`related_id` are all **polymorphic pointers**, not foreign keys — `related_id` is a plain integer that can point at a row in `crm_inquiries`, `crm_tenders`, or elsewhere depending on the string in `related_module`. This lets one attachment/note/discussion/stage-log table serve every CRM entity type, at the cost of referential integrity: the database cannot prevent a dangling `related_id`, and there's no way to `JOIN` generically without knowing which table `related_module` names. See `INDEXES.md` for how these are (and aren't) indexed.

## `users` as a hub with no reverse ORM relationships

`users` is referenced by id from nearly every module (`created_by_id`, `approver_id`, `raised_by_id`, `assigned_service_person_id`, etc.), but **no model anywhere declares an ORM `relationship()` back to `User`**, and most of these columns are plain `Integer` with **no DB-level FK constraint at all** — only `erp_project_attachment_shares.user_id`, and the `purchase`/`p2p` approver/raiser/buyer columns, actually declare `ForeignKey("users.id")`. Everything else (`erp_service_requests.created_by_id`, `crm_activities.created_by_id`, `rnd_calculation_history.user_id`, `notifications.user_id`, `feedback.user_id`, `audit_logs.performed_by_id`, etc.) is an unenforced integer pointer. This is a schema-wide pattern, not a one-off oversight — it means the database will not stop you from writing a `created_by_id` that doesn't correspond to a real user row; only a subset of user-facing FKs are backed by real constraints.

## `purchase` and `p2p` — two intentionally decoupled modules

These are **two separate, independently-evolving Purchase Requisition systems** living side by side in this codebase, and the split is deliberate, not accidental duplication:

| | `purchase` (`purchase_requisitions` table) | `p2p` (`p2p_requests` table) |
|---|---|---|
| Origin | Raised from a Service Request's Materials tab | Raised standalone, by any department, for any need |
| FK into `erp` | Yes — `project_id` → `erp_projects.id`, `service_request_id` → `erp_service_requests.id` (both non-nullable) | **None** — `project_label` is a free-text string, not an FK |
| ORM `relationship()` to `erp` models | **None**, despite the FK constraints existing at the DB level — see model docstring: "never imports ERP route/service code" | N/A (no FK to begin with) |
| Link back into `erp` | `erp_service_materials.pr_id` (nullable FK) plus a denormalized `pr_number`/`pr_status` mirror, kept in sync by `purchase/routes/purchase_requisitions.py`'s `_sync_material_pr_fields` | None |
| Item source | `purchase_requisition_items.service_material_id` → `erp_service_materials.id` — items are **snapshots** taken from ServiceMaterial at PR-raise time | `p2p_request_items` are authored directly on the request, no source table |
| Category/requirement-type/priority literal lists | `PR_CATEGORIES`, `PR_REQUIREMENT_TYPES`, `PR_PRIORITIES` in `purchase/models/purchase_requisition.py` | Same literal values, redefined independently in `p2p/models/p2p_request.py` — "kept as separate literal copies, not a cross-import" per that model's comment |
| Cost tracking | None (`unit_price`/`total_price` dropped in `9b88ecb3688b`) | None — was never added |

The documented rationale (from `purchase/models/purchase_requisition.py`'s class docstring): the `project_id`/`service_request_id` FKs plus the `pr_id`/`pr_number`/`pr_status` mirror on `ServiceMaterial` are "the exact seam that would become a webhook call if Purchase were ever split into its own service." In other words, the coupling that exists is deliberately kept thin (plain FK + a denormalized read-only mirror, no shared ORM graph, no cross-module Python imports of route/service code) so either module could be extracted into its own deployable service without a rewrite. `p2p_requests` has no such seam at all — it's fully standalone and shares nothing with `erp` or `crm`.

Practical implication for anyone extending this schema: **do not import models across these two Purchase modules**, and don't be surprised that a Service Request's "PR" and a standalone department's "PR" use the same status vocabulary (`submitted → approved → po_raised → partially_received → received → closed`, with `rejected`/`cancelled` branches) purely by convention, not by shared code.

## `rnd` module — fully isolated

No table in `rnd` has a foreign key to any other module, or to another `rnd` table. `user_id` on every `rnd_*` table is a plain unenforced integer. The only internal relationship is conceptual: `rnd_calculation_history` and the matching per-tool table (e.g. `rnd_braking_calculations`) are written together on every save by `history.save_history()`, but there is no FK linking a history row to its per-tool snapshot row — they're correlated only by `(user_id, tool_name, calculation_name, created_at)` at the application level, not by a shared key.

## Summary table

| Parent | Child | FK column | Nullable | Cascade (ORM) | Notes |
|---|---|---|---|---|---|
| erp_projects | erp_service_requests | project_id | no | delete-orphan | |
| erp_projects | erp_project_attachments | project_id | no | delete-orphan | |
| erp_project_attachments | erp_project_attachment_shares | attachment_id | no | delete-orphan (+ DB CASCADE) | |
| users | erp_project_attachment_shares | user_id | yes | — (DB CASCADE) | one of 3 mutually-exclusive share targets |
| erp_service_requests | erp_service_materials | service_request_id | no | delete-orphan | |
| erp_service_requests | erp_service_request_attachments | service_request_id | no | delete-orphan | |
| erp_service_materials | erp_service_material_attachments | service_material_id | no | delete-orphan | |
| erp_projects | purchase_requisitions | project_id | no | — | no ORM relationship either direction |
| erp_service_requests | purchase_requisitions | service_request_id | no | — | no ORM relationship either direction |
| purchase_requisitions | purchase_requisition_items | purchase_requisition_id | no | delete-orphan | |
| erp_service_materials | purchase_requisition_items | service_material_id | no | — | snapshot source, no ORM relationship |
| purchase_requisitions | erp_service_materials | pr_id (reverse) | yes | — | plus denormalized pr_number/pr_status mirror |
| users | purchase_requisitions | raised_by_id / approver_id / approved_by_id / closed_by_id | yes | — | |
| users | p2p_requests | requested_by_id / approver_id / assigned_buyer_id / approved_by_id / closed_by_id | yes | — | |
| p2p_requests | pr_request_items | pr_request_id | no | delete-orphan | |
| p2p_requests | pr_request_attachments | pr_request_id | no | delete-orphan | |
| pr_request_items | pr_request_attachments | item_id | yes | delete-orphan | optional per-item scoping |
| crm_organizations | crm_org_contacts | org_id | no | delete-orphan | |
| crm_organizations | crm_inquiries | org_id | no | — | |
| crm_organizations | crm_tenders | org_id | no | — | |
| crm_organizations | crm_purchase_orders | org_id | no | — | |
| crm_inquiries | crm_purchase_orders | inquiry_id | yes | — | |
| crm_tenders | crm_purchase_orders | tender_id | yes | — | |
| crm_inquiries | crm_inquiry_tasks / crm_inquiry_approvals / crm_quotations | inquiry_id | no | delete-orphan | |
| crm_tenders | crm_tender_tasks / crm_tender_competitors | tender_id | no | delete-orphan | |
| crm_activities | crm_activity_attachments | activity_id | no | delete-orphan | |
| crm_organizations | crm_activities / crm_notes / crm_documents | org_id | yes | — | |
| crm_org_contacts | crm_activities / crm_notes | org_contact_id | yes | — | |
| (polymorphic) | crm_activities / crm_notes / crm_documents / crm_discussions / crm_stage_logs | related_module + related_id | mixed | — | no DB FK, app-enforced only |

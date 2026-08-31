# Indexes

What's indexed, based on grepping every model under `backend/app/modules/*/models/*.py` for `index=True` / `unique=True`, plus `op.create_index` / `sa.UniqueConstraint` / `sa.inspect(...).get_unique_constraints()` calls in `backend/alembic/versions/*.py`. See [`SCHEMA.md`](./SCHEMA.md) for full column context.

## Unique indexes (business-key lookups)

| Table | Column(s) | Source |
|---|---|---|
| users | email | `unique=True, index=True` |
| users | azure_id | `unique=True` (no explicit `index=True`, but Postgres still needs an index to enforce uniqueness) |
| api_keys | key_hash | `unique=True, index=True` |
| erp_projects | serial_number | `unique=True, index=True` |
| erp_service_requests | request_number | `unique=True, index=True` |
| purchase_requisitions | pr_number | `unique=True, index=True` |
| pr_requests | pr_number | `unique=True, index=True` (also created explicitly via `op.create_index("ix_pr_requests_pr_number", ..., unique=True)` in `c3d9a1f6b8e2`) |
| crm_organizations | gst_number | `unique=True` (no `index=True`) |
| crm_inquiries | universal_id | `unique=True, index=True` |
| crm_tenders | universal_id | `unique=True, index=True` |
| erp_project_attachment_shares | (attachment_id, user_id) | Originally a named `UniqueConstraint("uq_project_attachment_share")` created in `f2a7c5e9d1b3`, then **dropped** in `a5d2f8c1e4b7` when department/designation sharing was added — a user can now be granted access to the same attachment via multiple share rows (e.g. once by name, once via their department), so uniqueness was intentionally removed, not overlooked. |

## Plain (non-unique) indexes

| Table | Column | Why |
|---|---|---|
| erp_service_requests | project_id | Every SR list/detail view filters by project |
| erp_service_requests | assigned_service_person_id | "My assigned SRs" queries |
| erp_service_requests | created_by_id | "Created by me" queries |
| purchase_requisitions | project_id, service_request_id | Both are near-mandatory join/filter paths from ERP into Purchase |
| crm_organizations | name | Organization search/autocomplete |
| crm_org_contacts | org_id | Contacts-by-organization lookups |
| crm_inquiries | org_id, created_by_id | Inquiries-by-org and "my inquiries" |
| crm_inquiry_tasks | inquiry_id | Tasks-by-inquiry |
| crm_inquiry_approvals | inquiry_id | Approvals-by-inquiry |
| crm_quotations | inquiry_id | Quotations-by-inquiry |
| crm_tenders | org_id, tender_number, created_by_id | Org filter, tender-number lookup, "my tenders" |
| crm_tender_tasks | tender_id | Tasks-by-tender |
| crm_tender_competitors | tender_id | Competitors-by-tender |
| crm_purchase_orders | inquiry_id, tender_id, org_id | All three are common filter paths |
| crm_activities | org_id, created_by_id | Org filter, "my activities" |
| crm_activity_attachments | activity_id | Attachments-by-activity |
| crm_notes | org_id, created_by_id | Same pattern as activities |
| crm_documents | related_id | The polymorphic pointer — see caveat below |
| crm_discussions | related_id | Same |
| crm_stage_logs | related_id | Same |
| feedback | user_id | Admin "unread feedback by user" queries |
| notifications | user_id | Per-user notification feed — the dominant query pattern for this table |
| rnd_calculation_history | user_id, tool_name | "My saved calcs" filtered by tool |
| rnd_spline_calculations | doc_no | Only per-tool table with an indexed business field beyond user_id |
| all `rnd_*_calculations` tables | user_id | "My saved calcs" per tool |
| audit_logs | entity_type | Filtering the audit trail by entity kind |

## Explicit `Index(...)` objects / migration-level `op.create_index`

There are no standalone `sa.Index(...)` declarations in any model file — every index in this codebase is expressed inline via `index=True` on a column. The only explicit `op.create_index` calls in the migrations are:
- `c3d9a1f6b8e2_add_pr_requests.py`: `op.create_index("ix_pr_requests_pr_number", "pr_requests", ["pr_number"], unique=True)` (guarded — only runs if `pr_requests` didn't already exist)
- `a1c3e7f92b48_add_feedback.py`: `op.create_index(op.f("ix_feedback_user_id"), "feedback", ["user_id"], unique=False)`

Everything else relies on Alembic's autogenerate picking up `index=True` from the model at migration-authoring time (via `Base.metadata.create_all()` in the baseline and "brand-new table" migrations), which is why most tables don't show a dedicated `op.create_index` call in the version files even though the column is indexed on the model.

## Where indexing looks thin (factual, no judgment)

These are gaps a reader would notice, stated as facts about what's present vs. absent — not a complaint that they're wrong for this app's scale:

- **Polymorphic `related_module` is never indexed, only `related_id` is** (`crm_activities`, `crm_notes`, `crm_documents`, `crm_discussions`, `crm_stage_logs`). A query that filters on both `related_module = 'inquiry' AND related_id = 42` (the actual access pattern for "show me everything attached to this Inquiry") uses the `related_id` index but still has to filter `related_module` afterward rather than using a composite index on `(related_module, related_id)`.
- **`erp_service_materials.service_request_id` has no explicit `index=True`** despite being a required FK that every Service Request's Materials tab filters by (relies on the FK's implicit index behavior varying by DB — Postgres does *not* automatically index FK columns, unlike some other databases, so this FK is genuinely unindexed).
- **`erp_project_attachments.project_id` has no `index=True`** — same situation, a required FK without an explicit index.
- **`purchase_requisition_items.purchase_requisition_id` and `.service_material_id`, `pr_request_items.pr_request_id`, `pr_request_attachments.pr_request_id`/`.item_id`, `erp_service_request_attachments.service_request_id`, `erp_service_material_attachments.service_material_id`, `crm_activity_attachments`'s parent is indexed but most other attachment/item child tables' parent FK is not** — the pattern is inconsistent module-to-module: some "child of a parent list" FKs got `index=True` (e.g. `crm_activity_attachments.activity_id`), most didn't.
- **Most `created_by_id`/`performed_by_id`/`assigned_*_id` columns pointing at `users` have neither an index nor a DB-level FK constraint** (see `RELATIONSHIPS.md`), so "show me everything created by user X" queries across `erp_projects`, `crm_documents`, `crm_org_contacts`, `crm_quotations`, `crm_inquiry_approvals`, `crm_purchase_orders`, `crm_discussions`, `crm_stage_logs`, `pr_request_attachments`, and the attachment tables would be full scans.
- **Postgres does not auto-index foreign keys** (unlike MySQL), so every FK column above without an explicit `index=True` truly has no index backing it — this is a real, not hypothetical, gap for any query that joins or filters on those columns at scale.

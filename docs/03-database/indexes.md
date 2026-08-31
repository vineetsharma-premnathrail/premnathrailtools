# Database — Indexes

**Module:** Database
**Backend Location:** `backend/app/modules/*/models/*.py`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This document records what is indexed in the Premnathrail Portal's database, and — just as importantly — what is not. It is based on a direct review of every model file under `backend/app/modules/*/models/*.py` for `index=True` and `unique=True` declarations, plus every `op.create_index`, `sa.UniqueConstraint`, and `sa.inspect(...).get_unique_constraints()` call in `backend/alembic/versions/*.py`. See [`schema.md`](./schema.md) for full column context on any table named below.

The intent of this document is to state facts about what indexing exists, not to render a verdict on whether the current level of indexing is adequate for the application's present scale. Some of the gaps noted in Section 4 are genuine risks as the database grows; others are simply choices that have not yet mattered in practice. Both are recorded so a future reader can make that judgment with full information.

---

# 2. Unique Indexes (Business-Key Lookups)

| Table | Column(s) | Source |
|---|---|---|
| users | email | `unique=True, index=True` |
| users | azure_id | `unique=True` (no explicit `index=True`, but Postgres still needs an index internally to enforce uniqueness) |
| api_keys | key_hash | `unique=True, index=True` |
| erp_projects | serial_number | `unique=True, index=True` |
| erp_service_requests | request_number | `unique=True, index=True` |
| purchase_requisitions | pr_number | `unique=True, index=True` |
| p2p_requests | p2p_number | `unique=True, index=True` (created explicitly via `op.create_index(..., unique=True)` when the table was renamed from `pr_requests`) |
| crm_organizations | gst_number | `unique=True` (no `index=True`) |
| crm_inquiries | universal_id | `unique=True, index=True` |
| crm_tenders | universal_id | `unique=True, index=True` |
| vendors | — | No unique business key declared as of this writing; vendor identity is matched by name in application code |
| erp_project_attachment_shares | (attachment_id, user_id) | Originally a named `UniqueConstraint("uq_project_attachment_share")`, added when the table was created, then **dropped** in `a5d2f8c1e4b7` when department/designation sharing was added — a user can now be granted access to the same attachment via multiple share rows (for example, once by name and once via their department), so the uniqueness was intentionally removed rather than overlooked. |

---

# 3. Plain (Non-Unique) Indexes

| Table | Column | Why |
|---|---|---|
| erp_service_requests | project_id | Every Service Request list/detail view filters by project |
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
| crm_documents | related_id | The polymorphic pointer — see caveat in Section 4 |
| crm_discussions | related_id | Same |
| crm_stage_logs | related_id | Same |
| feedback | user_id | Admin "unread feedback by user" queries |
| notifications | user_id | Per-user notification feed — the dominant query pattern for this table |
| rnd_calculation_history | user_id, tool_name | "My saved calcs" filtered by tool |
| rnd_spline_calculations | doc_no | The only per-tool R&D table with an indexed business field beyond user_id |
| all `rnd_*_calculations` tables | user_id | "My saved calcs" per tool |
| audit_logs | entity_type | Filtering the audit trail by entity kind |
| p2p_requests | p2p_number | (see Section 2 — this is also the unique index) |
| stock_items, store_locations, stock_balances, stock_transactions | item/location foreign keys | Item- and location-scoped stock lookups |

---

# 4. Where Indexing Looks Thin

These are gaps a careful reader would notice, stated as facts about what is present versus absent — not a claim that they are wrong for the application's current scale.

- **The polymorphic `related_module` column is never indexed; only `related_id` is.** This affects `crm_activities`, `crm_notes`, `crm_documents`, `crm_discussions`, and `crm_stage_logs`. The actual access pattern for these tables — "show me everything attached to this Inquiry" — filters on both `related_module = 'inquiry' AND related_id = 42`. Today's index on `related_id` alone means the database can narrow to rows with the right id but must still filter `related_module` afterward, rather than using a composite index on `(related_module, related_id)` that would satisfy the whole predicate directly.
- **`erp_service_materials.service_request_id` has no explicit `index=True`**, despite being a required foreign key that every Service Request's Materials tab filters by. Postgres, unlike some other databases, does not automatically index foreign-key columns — so this FK is genuinely unindexed, not merely undeclared.
- **`erp_project_attachments.project_id` has no `index=True`** — the same situation: a required foreign key without an explicit index.
- **Most attachment/item child tables' parent foreign key is inconsistently indexed.** `purchase_requisition_items.purchase_requisition_id` and `.service_material_id`, `p2p_request_items.p2p_request_id`, `p2p_request_attachments.p2p_request_id`/`.item_id`, `erp_service_request_attachments.service_request_id`, and `erp_service_material_attachments.service_material_id` are not explicitly indexed, while other structurally identical "child of a parent list" foreign keys — for example `crm_activity_attachments.activity_id` — are. The pattern varies module to module rather than following one consistent rule.
- **Most `created_by_id`/`performed_by_id`/`assigned_*_id` columns pointing at `users` have neither an index nor a database-level foreign-key constraint** (see [`relationships.md`](./relationships.md) Section 4), so "show me everything created by user X" queries across `erp_projects`, `crm_documents`, `crm_org_contacts`, `crm_quotations`, `crm_inquiry_approvals`, `crm_purchase_orders`, `crm_discussions`, `crm_stage_logs`, `p2p_request_attachments`, and the various attachment tables would be full table scans.
- **Postgres does not auto-index foreign keys**, unlike MySQL. Every foreign-key column noted above without an explicit `index=True` genuinely has no index behind it — this is a real, not hypothetical, gap for any query that joins or filters on those columns once table sizes grow.

---

# 5. How Indexes Are Declared in This Codebase

There are no standalone `sa.Index(...)` declarations in any model file — every index in this codebase is expressed inline via `index=True` on a column. Explicit `op.create_index` calls inside migration files are rare; when they appear, it is usually because the migration is adding an index to an existing column (rather than defining it on a brand-new table, where Alembic's autogenerate against `Base.metadata` picks up `index=True` automatically at migration-authoring time). This is why most tables do not show a dedicated `op.create_index` call in their version file even though the corresponding model column is indexed — the index was created implicitly as part of the table's `CREATE TABLE` statement.

---

# 6. Related Documents

- [`schema.md`](./schema.md) — full column-level reference for every table named above.
- [`er-diagram.md`](./er-diagram.md) — narrative description of table relationships.
- [`relationships.md`](./relationships.md) — foreign-key cardinality and cascade reference, including which of the columns above are, and are not, backed by a real constraint.
- [`migrations.md`](./migrations.md) — the Alembic history in which each index above was introduced.

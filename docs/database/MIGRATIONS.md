# Migrations

Chronological changelog of `backend/alembic/versions/`, ordered by following the
`down_revision` chain (not filename order, which is alphabetical by hash and does not
reflect actual sequence). Verified by reading each file's `revision`/`down_revision`.

| Order | Revision | File | Purpose (one line) |
|---|---|---|---|
| 1 | `ea1db0867f03` | ea1db0867f03_baseline.py | Baseline migration (root, `down_revision = None`) |
| 2 | `6f8a8c6a60c7` | 6f8a8c6a60c7_extend_user_model_with_remote_parity_.py | Extend `users` with fields for remote/production parity |
| 3 | `96f882353283` | 96f882353283_add_purchase_requisitions.py | Add `purchase_requisitions` / `purchase_requisition_items` (ERP-origin PR module) |
| 4 | `9b88ecb3688b` | 9b88ecb3688b_remove_material_pricing.py | Remove pricing columns from service materials |
| 5 | `c4d8f2a91b6e` | c4d8f2a91b6e_repair_crm_activities_schema_drift.py | Repair drift between `crm_activities` model and live schema |
| 6 | `a1c3e7f92b48` | a1c3e7f92b48_add_feedback.py | Add `feedback` table |
| 7 | `d3f6b1c9a2e4` | d3f6b1c9a2e4_add_activity_date_to_crm_activities.py | Add `activity_date` to `crm_activities` |
| 8 | `e7a2c4d8f1b6` | e7a2c4d8f1b6_add_mom_items_to_crm_activities.py | Add MOM (minutes-of-meeting) items to `crm_activities` |
| 9 | `f4b8d2e6c9a1` | f4b8d2e6c9a1_add_contact_ids_to_crm_activities.py | Add contact ID references to `crm_activities` |
| 10 | `b7c1e5a9d3f2` | b7c1e5a9d3f2_add_service_material_attachments.py | Add `erp_service_material_attachments` |
| 11 | `c9d4f7b2e8a1` | c9d4f7b2e8a1_drop_unused_service_material_columns.py | Drop unused columns from `erp_service_materials` |
| 12 | `a2d5e8f1c3b7` | a2d5e8f1c3b7_add_pr_item_remarks.py | Add remarks column to `purchase_requisition_items` |
| 13 | `d8e4b2f6a9c1` | d8e4b2f6a9c1_add_crm_activity_attachments.py | Add `crm_activity_attachments` |
| 14 | `e1f6a3c9b2d4` | e1f6a3c9b2d4_add_pr_priority_required_by_reason.py | Add priority/required-by/reason to a PR table |
| 15 | `f2a7c5e9d1b3` | f2a7c5e9d1b3_add_private_project_attachments.py | Add `is_private` flag to `erp_project_attachments` |
| 16 | `a5d2f8c1e4b7` | a5d2f8c1e4b7_add_department_designation_shares.py | Add `project_attachment_shares` (department/designation-scoped sharing) |
| 17 | `c3d9a1f6b8e2` | c3d9a1f6b8e2_add_p2p_requests.py | Add `p2p_requests` / `pr_request_items` / `pr_request_attachments` (new standalone Purchase Requisition module) |
| 18 | `d4e8b2c7a913` | d4e8b2c7a913_add_pr_request_attachment_item_id.py | Add nullable `item_id` FK on `pr_request_attachments` (link an attachment to a specific item) |
| 19 | `e7c1a9d4f256` | e7c1a9d4f256_add_pr_category_requirement_approver.py | Add category/requirement/approver columns to `p2p_requests` |
| 20 (head) | `f9a3c6e1b8d4` | f9a3c6e1b8d4_add_material_model_budget_reason.py | Add model number/budget/reason columns to `erp_service_materials` |

Confirm the current head against the repo directly (`alembic heads`) before relying on
this table for anything automated — it is a manually verified snapshot as of this
writing.

## Notable pattern: dominance of `p2p`-related migrations (13–19)

Migrations 12, 14, 16–19 are all shaping the new standalone `p2p_requests` /
`purchase_requisition_items` schema (remarks, priority/required-by/reason, department
shares, the initial table creation, attachment item-linking, category/requirement/
approver) — consistent with [ADR 0003](../adr/0003-independent-p2p-module.md):
this module was actively built out incrementally, migration by migration, as a
standalone concern.

## Standard workflow used in this repo

Confirmed from `backend/alembic/env.py` and the migration files themselves:

```bash
# Generate a new migration from current models vs. current DB state
alembic revision --autogenerate -m "add_x_to_y"

# Apply all pending migrations
alembic upgrade head

# Check current head / history
alembic current
alembic history
```

`backend/app/main.py` explicitly documents that `Base.metadata.create_all()` is **not**
called at startup anymore — the comment there says schema is Alembic-managed and
`create_all()` can't apply `ALTER TABLE`s to existing tables, only `CREATE TABLE` for
brand-new ones. This means every schema change, however small, must go through a
migration file — there is no implicit dev-mode auto-sync.

## Defensive idempotency pattern

At least 16 of the 20 migration files (grep for `get_table_names`/`get_columns`) guard
their `upgrade()` body with an `sa.inspect(...)` check before creating a table or adding
a column, e.g. (paraphrased from `c3d9a1f6b8e2_add_p2p_requests.py`):

```python
inspector = sa.inspect(op.get_bind())
existing_tables = set(inspector.get_table_names())
if "p2p_requests" not in existing_tables:
    op.create_table("p2p_requests", ...)
```

This exists so that migrations are **safe to re-run against a partially-applied
database** — e.g. if a deploy was interrupted mid-migration, or if a table/column was
already added manually/out-of-band, re-running `alembic upgrade head` won't fail with a
"table/column already exists" error. It trades a bit of verbosity in every migration
file for resilience against inconsistent database state across environments
(local/staging/production), which matters more here than in a project with a single
tightly-controlled deploy pipeline.

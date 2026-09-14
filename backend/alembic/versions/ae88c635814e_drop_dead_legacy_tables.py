"""drop dead legacy tables

Revision ID: ae88c635814e
Revises: a1e6c8b3d5f9
Create Date: 2026-09-12 00:00:00.000000

Removes tables left behind by superseded/abandoned features. None of these
have any current SQLAlchemy model, route, or frontend reference, and all are
empty (or, for `vendors`, hold no data used by any live code path):

- Asset Management module (assets, asset_categories, asset_events,
  asset_locations): migration exists but the module was never built —
  no `app/modules/asset` package exists.
- electrical_work_orders, engineering_documents: same — migrated, never
  wired to any module.
- Pre-P2P-rewrite "purchase_*" prototype schema (purchase_orders,
  purchase_order_items, purchase_invoices, purchase_documents,
  purchase_goods_receipts, purchase_goods_receipt_items,
  purchase_quotations, purchase_rfqs, purchase_rfq_vendors,
  purchase_vendors, vendors): superseded by the current `p2p_*` tables.
  `vendors` is still FK-referenced by `p2p_purchase_orders.vendor_id` and
  `p2p_vendor_quotations.vendor_id`, but neither model declares that FK —
  vendor identity there is free-text `vendor_name`, so the constraint is
  vestigial and is dropped before the table.
- Pre-rewrite CRM schema (crm_notes, crm_discussions,
  crm_activity_client_contacts, crm_activity_observations,
  crm_activity_pew_members): superseded by crm_activities /
  crm_activity_attachments.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ae88c635814e'
down_revision = 'a1e6c8b3d5f9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    def drop_fk_if_exists(table: str, constraint: str) -> None:
        if table not in existing_tables:
            return
        fk_names = {fk["name"] for fk in inspector.get_foreign_keys(table)}
        if constraint in fk_names:
            op.drop_constraint(constraint, table, type_="foreignkey")

    def drop_table_if_exists(table: str) -> None:
        if table in existing_tables:
            op.drop_table(table)

    # Vestigial FKs pointing at `vendors` — not reflected in either model.
    drop_fk_if_exists("p2p_purchase_orders", "p2p_purchase_orders_vendor_id_fkey")
    drop_fk_if_exists("p2p_vendor_quotations", "p2p_vendor_quotations_vendor_id_fkey")

    # Asset Management module (never built).
    drop_table_if_exists("asset_events")
    drop_table_if_exists("assets")
    drop_table_if_exists("asset_categories")
    drop_table_if_exists("asset_locations")

    # Standalone, never-wired-up tables.
    drop_table_if_exists("electrical_work_orders")
    drop_table_if_exists("engineering_documents")

    # Pre-P2P-rewrite "purchase_*" prototype schema.
    drop_table_if_exists("purchase_invoices")
    drop_table_if_exists("purchase_goods_receipt_items")
    drop_table_if_exists("purchase_goods_receipts")
    drop_table_if_exists("purchase_order_items")
    drop_table_if_exists("purchase_quotations")
    drop_table_if_exists("purchase_rfq_vendors")
    drop_table_if_exists("purchase_orders")
    drop_table_if_exists("purchase_rfqs")
    drop_table_if_exists("purchase_documents")
    drop_table_if_exists("purchase_vendors")
    drop_table_if_exists("vendors")

    # Pre-rewrite CRM schema.
    drop_table_if_exists("crm_activity_client_contacts")
    drop_table_if_exists("crm_activity_observations")
    drop_table_if_exists("crm_activity_pew_members")
    drop_table_if_exists("crm_notes")
    drop_table_if_exists("crm_discussions")


def downgrade() -> None:
    raise RuntimeError(
        "Irreversible: dropped tables held no data used by any current code "
        "path. Restore from a pre-migration database backup if needed."
    )

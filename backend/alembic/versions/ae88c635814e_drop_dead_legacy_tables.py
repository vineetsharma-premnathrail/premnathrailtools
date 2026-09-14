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


# revision identifiers, used by Alembic.
revision = 'ae88c635814e'
down_revision = 'a1e6c8b3d5f9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Vestigial FKs pointing at `vendors` — not reflected in either model.
    op.drop_constraint("p2p_purchase_orders_vendor_id_fkey", "p2p_purchase_orders", type_="foreignkey")
    op.drop_constraint("p2p_vendor_quotations_vendor_id_fkey", "p2p_vendor_quotations", type_="foreignkey")

    # Asset Management module (never built).
    op.drop_table("asset_events")
    op.drop_table("assets")
    op.drop_table("asset_categories")
    op.drop_table("asset_locations")

    # Standalone, never-wired-up tables.
    op.drop_table("electrical_work_orders")
    op.drop_table("engineering_documents")

    # Pre-P2P-rewrite "purchase_*" prototype schema.
    op.drop_table("purchase_invoices")
    op.drop_table("purchase_goods_receipt_items")
    op.drop_table("purchase_goods_receipts")
    op.drop_table("purchase_order_items")
    op.drop_table("purchase_quotations")
    op.drop_table("purchase_rfq_vendors")
    op.drop_table("purchase_orders")
    op.drop_table("purchase_rfqs")
    op.drop_table("purchase_documents")
    op.drop_table("purchase_vendors")
    op.drop_table("vendors")

    # Pre-rewrite CRM schema.
    op.drop_table("crm_activity_client_contacts")
    op.drop_table("crm_activity_observations")
    op.drop_table("crm_activity_pew_members")
    op.drop_table("crm_notes")
    op.drop_table("crm_discussions")


def downgrade() -> None:
    raise RuntimeError(
        "Irreversible: dropped tables held no data used by any current code "
        "path. Restore from a pre-migration database backup if needed."
    )

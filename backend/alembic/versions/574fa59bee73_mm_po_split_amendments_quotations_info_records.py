"""MM purchasing (2026-10-14): ME21N PO split by vendor (line PR link,
delivery date, plant / ship-to), ME22N PO amendments with re-release,
ME47 line-level quotations, ME11 info records keyed by Item Master id and
the ME01 source list.

Revision ID: 574fa59bee73
Revises: 9f550ec8b661
"""
from alembic import op
import sqlalchemy as sa

revision = "574fa59bee73"
down_revision = "9f550ec8b661"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    # ME47 quote header terms
    have = _cols("p2p_vendor_quotations")
    with op.batch_alter_table("p2p_vendor_quotations") as b:
        if "quote_ref" not in have:
            b.add_column(sa.Column("quote_ref", sa.String(100), nullable=True))
        if "valid_until" not in have:
            b.add_column(sa.Column("valid_until", sa.Date(), nullable=True))
        if "freight_total" not in have:
            b.add_column(sa.Column("freight_total", sa.Float(), nullable=True))
        if "packing_total" not in have:
            b.add_column(sa.Column("packing_total", sa.Float(), nullable=True))

    if "p2p_vendor_quotation_items" not in existing:
        op.create_table(
            "p2p_vendor_quotation_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("vendor_quotation_id", sa.Integer(), sa.ForeignKey("p2p_vendor_quotations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("pr_item_id", sa.Integer(), sa.ForeignKey("p2p_request_items.id"), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=True),
            sa.Column("unit_price", sa.Float(), nullable=False),
            sa.Column("discount_pct", sa.Float(), nullable=True),
            sa.Column("gst_rate", sa.Float(), nullable=True),
            sa.Column("delivery_days", sa.Integer(), nullable=True),
            sa.Column("make_offered", sa.String(150), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("is_awarded", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("award_reason", sa.Text(), nullable=True),
            sa.Column("awarded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("awarded_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
        )
        op.create_index("ix_p2p_vendor_quotation_items_vendor_quotation_id", "p2p_vendor_quotation_items", ["vendor_quotation_id"])
        op.create_index("ix_p2p_vendor_quotation_items_pr_item_id", "p2p_vendor_quotation_items", ["pr_item_id"])
        op.create_index("ix_p2p_vendor_quotation_items_store_item_id", "p2p_vendor_quotation_items", ["store_item_id"])

    # ME21N PO header
    have = _cols("p2p_purchase_orders")
    with op.batch_alter_table("p2p_purchase_orders") as b:
        if "plant_branch_id" not in have:
            b.add_column(sa.Column("plant_branch_id", sa.Integer(), sa.ForeignKey("branches.id", name="fk_p2p_po_plant_branch"), nullable=True))
        if "ship_to_location_id" not in have:
            b.add_column(sa.Column("ship_to_location_id", sa.Integer(), sa.ForeignKey("store_locations.id", name="fk_p2p_po_ship_to"), nullable=True))
        if "vendor_quotation_id" not in have:
            b.add_column(sa.Column("vendor_quotation_id", sa.Integer(), sa.ForeignKey("p2p_vendor_quotations.id", name="fk_p2p_po_vendor_quotation"), nullable=True))
        if "amendment_no" not in have:
            b.add_column(sa.Column("amendment_no", sa.Integer(), nullable=False, server_default="0"))

    # ME21N PO lines
    have = _cols("p2p_purchase_order_items")
    with op.batch_alter_table("p2p_purchase_order_items") as b:
        if "pr_item_id" not in have:
            b.add_column(sa.Column("pr_item_id", sa.Integer(), sa.ForeignKey("p2p_request_items.id", name="fk_p2p_po_item_pr_item"), nullable=True))
            b.create_index("ix_p2p_purchase_order_items_pr_item_id", ["pr_item_id"])
        if "delivery_date" not in have:
            b.add_column(sa.Column("delivery_date", sa.Date(), nullable=True))
        if "ship_to_location_id" not in have:
            b.add_column(sa.Column("ship_to_location_id", sa.Integer(), sa.ForeignKey("store_locations.id", name="fk_p2p_po_item_ship_to"), nullable=True))
        if "vendor_quotation_item_id" not in have:
            b.add_column(sa.Column("vendor_quotation_item_id", sa.Integer(),
                                   sa.ForeignKey("p2p_vendor_quotation_items.id", name="fk_p2p_po_item_quote_item"), nullable=True))
        if "price_source" not in have:
            b.add_column(sa.Column("price_source", sa.String(20), nullable=True))
        if "price_override_reason" not in have:
            b.add_column(sa.Column("price_override_reason", sa.Text(), nullable=True))

    # Backfill: a PO line on a PR whose PR has exactly one line with the same
    # Item Master id gets that PR line (pure id match, never by name).
    op.execute("""
        UPDATE p2p_purchase_order_items AS poi SET pr_item_id = (
            SELECT pri.id FROM p2p_request_items pri
            JOIN p2p_purchase_orders po ON po.p2p_request_id = pri.p2p_request_id
            WHERE po.id = poi.purchase_order_id AND pri.store_item_id = poi.store_item_id
        )
        WHERE poi.pr_item_id IS NULL AND poi.store_item_id IS NOT NULL AND (
            SELECT COUNT(*) FROM p2p_request_items pri
            JOIN p2p_purchase_orders po ON po.p2p_request_id = pri.p2p_request_id
            WHERE po.id = poi.purchase_order_id AND pri.store_item_id = poi.store_item_id
        ) = 1
    """)

    if "p2p_po_amendments" not in existing:
        op.create_table(
            "p2p_po_amendments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id"), nullable=False),
            sa.Column("amendment_no", sa.Integer(), nullable=False),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending_approval"),
            sa.Column("changes", sa.JSON(), nullable=False),
            sa.Column("before", sa.JSON(), nullable=False),
            sa.Column("after", sa.JSON(), nullable=False),
            sa.Column("old_total", sa.Float(), nullable=True),
            sa.Column("new_total", sa.Float(), nullable=True),
            sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decision_comment", sa.Text(), nullable=True),
            *_ts(),
        )
        op.create_index("ix_p2p_po_amendments_purchase_order_id", "p2p_po_amendments", ["purchase_order_id"])

    # ME11 info record fields on the shared vendor catalog
    have = _cols("vendor_catalog_items")
    with op.batch_alter_table("vendor_catalog_items") as b:
        if "store_item_id" not in have:
            b.add_column(sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id", name="fk_vendor_catalog_store_item"), nullable=True))
            b.create_index("ix_vendor_catalog_items_store_item_id", ["store_item_id"])
        if "min_order_qty" not in have:
            b.add_column(sa.Column("min_order_qty", sa.Float(), nullable=True))
        if "valid_from" not in have:
            b.add_column(sa.Column("valid_from", sa.Date(), nullable=True))
        if "valid_to" not in have:
            b.add_column(sa.Column("valid_to", sa.Date(), nullable=True))
        if "last_po_id" not in have:
            b.add_column(sa.Column("last_po_id", sa.Integer(), nullable=True))
        if "last_po_number" not in have:
            b.add_column(sa.Column("last_po_number", sa.String(50), nullable=True))
        if "last_po_date" not in have:
            b.add_column(sa.Column("last_po_date", sa.Date(), nullable=True))
        if "last_po_price" not in have:
            b.add_column(sa.Column("last_po_price", sa.Float(), nullable=True))

    if "p2p_source_list" not in existing:
        op.create_table(
            "p2p_source_list",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=False),
            sa.Column("valid_from", sa.Date(), nullable=True),
            sa.Column("valid_to", sa.Date(), nullable=True),
            sa.Column("is_fixed", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_blocked", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("store_item_id", "vendor_id", name="uq_p2p_source_list_item_vendor"),
        )
        op.create_index("ix_p2p_source_list_store_item_id", "p2p_source_list", ["store_item_id"])
        op.create_index("ix_p2p_source_list_vendor_id", "p2p_source_list", ["vendor_id"])


def downgrade() -> None:
    op.drop_table("p2p_source_list")
    with op.batch_alter_table("vendor_catalog_items") as b:
        b.drop_index("ix_vendor_catalog_items_store_item_id")
        b.drop_constraint("fk_vendor_catalog_store_item", type_="foreignkey")
        for c in ("store_item_id", "min_order_qty", "valid_from", "valid_to", "last_po_id", "last_po_number", "last_po_date", "last_po_price"):
            b.drop_column(c)
    op.drop_table("p2p_po_amendments")
    with op.batch_alter_table("p2p_purchase_order_items") as b:
        b.drop_index("ix_p2p_purchase_order_items_pr_item_id")
        for fk in ("fk_p2p_po_item_pr_item", "fk_p2p_po_item_ship_to", "fk_p2p_po_item_quote_item"):
            b.drop_constraint(fk, type_="foreignkey")
        for c in ("pr_item_id", "delivery_date", "ship_to_location_id", "vendor_quotation_item_id", "price_source", "price_override_reason"):
            b.drop_column(c)
    with op.batch_alter_table("p2p_purchase_orders") as b:
        for fk in ("fk_p2p_po_plant_branch", "fk_p2p_po_ship_to", "fk_p2p_po_vendor_quotation"):
            b.drop_constraint(fk, type_="foreignkey")
        for c in ("plant_branch_id", "ship_to_location_id", "vendor_quotation_id", "amendment_no"):
            b.drop_column(c)
    op.drop_table("p2p_vendor_quotation_items")
    with op.batch_alter_table("p2p_vendor_quotations") as b:
        for c in ("quote_ref", "valid_until", "freight_total", "packing_total"):
            b.drop_column(c)

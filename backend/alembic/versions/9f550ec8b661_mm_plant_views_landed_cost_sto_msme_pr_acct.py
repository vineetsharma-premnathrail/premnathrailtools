"""MM wave 2 (2026-10-14): material master plant views (MM01 plant / MRP
views), PO delivery costs + landed-cost vouchers, stock transport between
plants with GST (branch GSTIN / state, tax invoice vs delivery challan),
vendor MSME (Udyam) data, PR account assignment FKs.

Revision ID: 9f550ec8b661
Revises: abc1fc700df1
"""
from alembic import op
import sqlalchemy as sa

revision = "9f550ec8b661"
down_revision = "abc1fc700df1"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _add(table: str, *columns: sa.Column) -> None:
    have = _cols(table)
    todo = [c for c in columns if c.name not in have]
    if todo:
        with op.batch_alter_table(table) as b:
            for c in todo:
                b.add_column(c)


def _drop(table: str, *names: str) -> None:
    have = _cols(table)
    todo = [n for n in names if n in have]
    if todo:
        with op.batch_alter_table(table) as b:
            for n in todo:
                b.drop_column(n)


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    # 1. Material master plant views (one row per item per plant).
    if "store_item_plants" not in existing:
        op.create_table(
            "store_item_plants",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=False, index=True),
            sa.Column("mrp_type", sa.String(20), nullable=False, server_default="reorder_point"),
            sa.Column("procurement_type", sa.String(10), nullable=False, server_default="buy"),
            sa.Column("reorder_level", sa.Float(), nullable=True),
            sa.Column("safety_stock", sa.Float(), nullable=True),
            sa.Column("minimum_stock", sa.Float(), nullable=True),
            sa.Column("maximum_stock", sa.Float(), nullable=True),
            sa.Column("reorder_quantity", sa.Float(), nullable=True),
            sa.Column("lead_time_days", sa.Integer(), nullable=True),
            sa.Column("inhouse_production_days", sa.Integer(), nullable=True),
            sa.Column("default_location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
            sa.Column("purchasing_blocked", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_ts(),
            sa.UniqueConstraint("item_id", "branch_id", name="uq_store_item_plants_item_branch"),
        )

    # 2. PO delivery costs (planned conditions) and landed-cost vouchers.
    if "p2p_po_charges" not in existing:
        op.create_table(
            "p2p_po_charges",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("charge_type", sa.String(20), nullable=False),
            sa.Column("description", sa.String(200), nullable=True),
            sa.Column("basis", sa.String(10), nullable=False, server_default="value"),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("gst_rate", sa.Float(), nullable=True),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
    if "p2p_landed_cost_vouchers" not in existing:
        op.create_table(
            "p2p_landed_cost_vouchers",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("voucher_number", sa.String(50), nullable=False, unique=True, index=True),
            sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id"), nullable=False, index=True),
            sa.Column("voucher_date", sa.Date(), nullable=False),
            sa.Column("charge_type", sa.String(20), nullable=False),
            sa.Column("description", sa.String(200), nullable=True),
            sa.Column("basis", sa.String(10), nullable=False, server_default="value"),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("gst_rate", sa.Float(), nullable=True),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("bill_reference", sa.String(100), nullable=True),
            sa.Column("value_to_stock", sa.Float(), nullable=False, server_default="0"),
            sa.Column("value_to_consumption", sa.Float(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="posted"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
    if "p2p_landed_cost_allocations" not in existing:
        op.create_table(
            "p2p_landed_cost_allocations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("voucher_id", sa.Integer(), sa.ForeignKey("p2p_landed_cost_vouchers.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("po_item_id", sa.Integer(), sa.ForeignKey("p2p_purchase_order_items.id"), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("basis_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("basis_value", sa.Float(), nullable=False, server_default="0"),
            sa.Column("allocated_amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("to_stock", sa.Float(), nullable=False, server_default="0"),
            sa.Column("to_consumption", sa.Float(), nullable=False, server_default="0"),
            *_ts(),
        )

    # 3. Stock transport between plants: plant GST identity + transfer tax data.
    _add("branches", sa.Column("gstin", sa.String(15), nullable=True), sa.Column("state_code", sa.String(2), nullable=True))
    _add("store_stock_transfers",
         sa.Column("document_type", sa.String(20), nullable=True),
         sa.Column("inter_state", sa.Boolean(), nullable=False, server_default=sa.false()),
         sa.Column("tax_invoice_number", sa.String(30), nullable=True),
         sa.Column("from_gstin", sa.String(15), nullable=True),
         sa.Column("to_gstin", sa.String(15), nullable=True),
         sa.Column("taxable_value", sa.Float(), nullable=True),
         sa.Column("cgst_amount", sa.Float(), nullable=True),
         sa.Column("sgst_amount", sa.Float(), nullable=True),
         sa.Column("igst_amount", sa.Float(), nullable=True))
    _add("store_stock_transfer_items",
         sa.Column("transfer_rate", sa.Float(), nullable=True),
         sa.Column("gst_rate", sa.Float(), nullable=True),
         sa.Column("taxable_value", sa.Float(), nullable=True),
         sa.Column("tax_amount", sa.Float(), nullable=True))

    # 4. Vendor MSME (MSMED Act / Udyam; Income-tax 43B(h)).
    _add("vendors",
         sa.Column("msme_category", sa.String(10), nullable=True),
         sa.Column("udyam_number", sa.String(25), nullable=True),
         sa.Column("msme_activity", sa.String(15), nullable=True),
         sa.Column("msme_valid_from", sa.Date(), nullable=True))

    # 5. PR account assignment (project_label stays as display text; nothing is
    #    mapped automatically from the old free text).
    _add("p2p_requests",
         sa.Column("account_assignment", sa.String(20), nullable=True),
         sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id"), nullable=True),
         sa.Column("cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=True),
         sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("production_work_orders.id"), nullable=True),
         sa.Column("internal_order_id", sa.Integer(), sa.ForeignKey("internal_orders.id"), nullable=True))


def downgrade() -> None:
    _drop("p2p_requests", "internal_order_id", "work_order_id", "cost_center_id", "sales_order_id", "account_assignment")
    _drop("vendors", "msme_valid_from", "msme_activity", "udyam_number", "msme_category")
    _drop("store_stock_transfer_items", "tax_amount", "taxable_value", "gst_rate", "transfer_rate")
    _drop("store_stock_transfers", "igst_amount", "sgst_amount", "cgst_amount", "taxable_value", "to_gstin", "from_gstin",
          "tax_invoice_number", "inter_state", "document_type")
    _drop("branches", "state_code", "gstin")
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for t in ("p2p_landed_cost_allocations", "p2p_landed_cost_vouchers", "p2p_po_charges", "store_item_plants"):
        if t in existing:
            op.drop_table(t)

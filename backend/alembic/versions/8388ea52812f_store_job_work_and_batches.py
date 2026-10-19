"""Store: job work / subcontracting (stock with vendor, job work receipts,
ITC-04 reminders) and batch management (batch master with heat no. + mill TC).

- store_stock_balances.vendor_qty — WITH VENDOR stock (SAP special stock O)
- store_material_issues.jobwork_reminded_days — GST Rule 45 reminder step sent
- store_batches — batch master (item, internal batch no., heat no., GRN line, TC)
- store_job_work_receipts / _components — processed item back from the job worker
- index on store_stock_transactions (item_id, batch_number) for stock by batch

Revision ID: 8388ea52812f
Revises: f4b92c6a05de
"""
from alembic import op
import sqlalchemy as sa

revision = "8388ea52812f"
down_revision = "f4b92c6a05de"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _ts() -> list[sa.Column]:
    return [sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True)]


def upgrade() -> None:
    if "vendor_qty" not in _columns("store_stock_balances"):
        with op.batch_alter_table("store_stock_balances") as b:
            b.add_column(sa.Column("vendor_qty", sa.Float(), nullable=False, server_default="0"))
    if "jobwork_reminded_days" not in _columns("store_material_issues"):
        with op.batch_alter_table("store_material_issues") as b:
            b.add_column(sa.Column("jobwork_reminded_days", sa.Integer(), nullable=True))

    tables = _tables()
    if "store_batches" not in tables:
        op.create_table(
            "store_batches",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("batch_number", sa.String(100), nullable=False),
            sa.Column("heat_number", sa.String(100), nullable=True),
            sa.Column("vendor_id", sa.Integer(), nullable=True),
            sa.Column("vendor_name", sa.String(255), nullable=True),
            sa.Column("grn_id", sa.Integer(), sa.ForeignKey("p2p_goods_receipts.id"), nullable=True),
            sa.Column("grn_item_id", sa.Integer(), sa.ForeignKey("p2p_goods_receipt_items.id"), nullable=True),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=True),
            sa.Column("received_qty", sa.Float(), nullable=False, server_default="0"),
            sa.Column("accepted_qty", sa.Float(), nullable=True),
            sa.Column("received_date", sa.Date(), nullable=True),
            sa.Column("mfg_date", sa.Date(), nullable=True),
            sa.Column("expiry_date", sa.Date(), nullable=True),
            sa.Column("tc_number", sa.String(100), nullable=True),
            sa.Column("tc_file_name", sa.String(255), nullable=True),
            sa.Column("tc_file_path", sa.String(1000), nullable=True),
            sa.Column("tc_content_type", sa.String(150), nullable=True),
            sa.Column("tc_uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("tc_uploaded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("item_id", "batch_number", name="uq_store_batch_item_number"),
        )
        op.create_index("ix_store_batches_item_id", "store_batches", ["item_id"])
        op.create_index("ix_store_batches_batch_number", "store_batches", ["batch_number"])
        op.create_index("ix_store_batches_heat_number", "store_batches", ["heat_number"])
        op.create_index("ix_store_batches_grn_id", "store_batches", ["grn_id"])
        op.create_index("ix_store_batches_grn_item_id", "store_batches", ["grn_item_id"])

    if "store_job_work_receipts" not in tables:
        op.create_table(
            "store_job_work_receipts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("receipt_number", sa.String(50), nullable=False),
            sa.Column("issue_id", sa.Integer(), sa.ForeignKey("store_material_issues.id"), nullable=False),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("vendors.id"), nullable=True),
            sa.Column("vendor_name", sa.String(255), nullable=True),
            sa.Column("receipt_date", sa.Date(), nullable=False),
            sa.Column("vendor_challan_number", sa.String(50), nullable=True),
            sa.Column("output_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("output_quantity", sa.Float(), nullable=False),
            sa.Column("output_batch_number", sa.String(100), nullable=True),
            sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("p2p_purchase_orders.id"), nullable=True),
            sa.Column("purchase_order_item_id", sa.Integer(), sa.ForeignKey("p2p_purchase_order_items.id"), nullable=True),
            sa.Column("job_charge_rate", sa.Numeric(18, 4), nullable=True),
            sa.Column("component_value", sa.Numeric(18, 2), nullable=True),
            sa.Column("output_unit_cost", sa.Numeric(18, 4), nullable=True),
            sa.Column("inspection_lot_id", sa.Integer(), sa.ForeignKey("quality_inspection_lots.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_store_job_work_receipts_receipt_number", "store_job_work_receipts", ["receipt_number"], unique=True)
        op.create_index("ix_store_job_work_receipts_issue_id", "store_job_work_receipts", ["issue_id"])

    if "store_job_work_receipt_components" not in tables:
        op.create_table(
            "store_job_work_receipt_components",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("receipt_id", sa.Integer(), sa.ForeignKey("store_job_work_receipts.id"), nullable=False),
            sa.Column("issue_item_id", sa.Integer(), sa.ForeignKey("store_material_issue_items.id"), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("consumed_quantity", sa.Float(), nullable=False, server_default="0"),
            sa.Column("scrap_quantity", sa.Float(), nullable=False, server_default="0"),
            sa.Column("batch_number", sa.String(100), nullable=True),
            sa.Column("value", sa.Numeric(18, 2), nullable=True),
            *_ts(),
        )
        op.create_index("ix_store_job_work_receipt_components_receipt_id", "store_job_work_receipt_components", ["receipt_id"])
        op.create_index("ix_store_job_work_receipt_components_issue_item_id", "store_job_work_receipt_components", ["issue_item_id"])

    existing = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("store_stock_transactions")}
    if "ix_store_stock_transactions_item_batch" not in existing:
        op.create_index("ix_store_stock_transactions_item_batch", "store_stock_transactions", ["item_id", "batch_number"])


def downgrade() -> None:
    existing = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("store_stock_transactions")}
    if "ix_store_stock_transactions_item_batch" in existing:
        op.drop_index("ix_store_stock_transactions_item_batch", table_name="store_stock_transactions")
    tables = _tables()
    if "store_job_work_receipt_components" in tables:
        op.drop_table("store_job_work_receipt_components")
    if "store_job_work_receipts" in tables:
        op.drop_table("store_job_work_receipts")
    if "store_batches" in tables:
        op.drop_table("store_batches")
    if "jobwork_reminded_days" in _columns("store_material_issues"):
        with op.batch_alter_table("store_material_issues") as b:
            b.drop_column("jobwork_reminded_days")
    if "vendor_qty" in _columns("store_stock_balances"):
        with op.batch_alter_table("store_stock_balances") as b:
            b.drop_column("vendor_qty")

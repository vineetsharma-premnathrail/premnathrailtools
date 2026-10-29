"""Job work receipt: several processed items back on one receipt.

Material sent on one challan can come back as different items (one plate cut
into a flange and a ring). New table store_job_work_receipt_outputs holds one
row per item received; every existing receipt gets one output row copied from
its header (item, quantity, batch, job charge, unit cost, inspection lot), so
old receipts read the same way. The header output_* columns stay (first line).

Revision ID: 41292e2c20ef
Revises: f6b8d0a2c4e7
Create Date: 2026-10-28
"""
from alembic import op
import sqlalchemy as sa

revision = "41292e2c20ef"
down_revision = "f6b8d0a2c4e7"
branch_labels = None
depends_on = None

TABLE = "store_job_work_receipt_outputs"


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if TABLE not in insp.get_table_names():
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("receipt_id", sa.Integer, sa.ForeignKey("store_job_work_receipts.id"), nullable=False),
            sa.Column("item_id", sa.Integer, sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("quantity", sa.Float, nullable=False),
            sa.Column("batch_number", sa.String(100), nullable=True),
            sa.Column("purchase_order_item_id", sa.Integer, sa.ForeignKey("p2p_purchase_order_items.id"), nullable=True),
            sa.Column("job_charge_rate", sa.Numeric(18, 4), nullable=True),
            sa.Column("cost_share_pct", sa.Float, nullable=True),
            sa.Column("component_value", sa.Numeric(18, 2), nullable=True),
            sa.Column("unit_cost", sa.Numeric(18, 4), nullable=True),
            sa.Column("inspection_lot_id", sa.Integer, sa.ForeignKey("quality_inspection_lots.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )
    idx = {i["name"] for i in sa.inspect(bind).get_indexes(TABLE)}
    for col in ("receipt_id", "item_id"):
        name = f"ix_{TABLE}_{col}"
        if name not in idx:
            op.create_index(name, TABLE, [col])
    # One output row per existing receipt, from its header (idempotent).
    op.execute(sa.text(f"""
        INSERT INTO {TABLE} (receipt_id, item_id, quantity, batch_number, purchase_order_item_id, job_charge_rate,
                             cost_share_pct, component_value, unit_cost, inspection_lot_id, created_at, updated_at)
        SELECT r.id, r.output_item_id, r.output_quantity, r.output_batch_number, r.purchase_order_item_id, r.job_charge_rate,
               100, r.component_value, r.output_unit_cost, r.inspection_lot_id, r.created_at, r.updated_at
        FROM store_job_work_receipts r
        WHERE NOT EXISTS (SELECT 1 FROM {TABLE} o WHERE o.receipt_id = r.id)
    """))


def downgrade() -> None:
    if TABLE in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table(TABLE)

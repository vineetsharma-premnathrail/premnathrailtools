"""Production: eBOM -> mBOM transfer link, GR at actual order cost, period-end WIP (2026-10-13).

- production_boms: design_bom_id / design_bom_revision_id / design_revision_label /
  transferred_at / transferred_by_id — the released Design BOM revision a
  Production BOM version was taken from.
- production_bom_items.make_buy — copied from the Design BOM line.
- production_work_orders.cost_relieved — actual cost moved into FG stock by receipts.
- production_time_logs.activity_rate — workstation rate snapshotted at booking.
- production_order_cost_postings (new) — dated, valued material movements of
  a work order (issue / return / goods receipt). Backfilled from the Store
  ledger rows that reference each work order (rate = the row's value when
  Store valued it, else the item's standard / moving-average cost).
- inventory_valuation_lines.line_kind ('stock' | 'wip') / work_order_id — WIP
  lines in Finance's closing-stock valuation.

Revision ID: 7523fd99f61e
Revises: 8388ea52812f
"""
from alembic import op
import sqlalchemy as sa

revision = "7523fd99f61e"
down_revision = "8388ea52812f"
branch_labels = None
depends_on = None


def _cols(insp, table):
    return {c["name"] for c in insp.get_columns(table)}


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)

    cols = _cols(insp, "production_boms")
    with op.batch_alter_table("production_boms") as b:
        if "design_bom_id" not in cols:
            b.add_column(sa.Column("design_bom_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_production_boms_design_bom_id", "design_boms", ["design_bom_id"], ["id"])
            b.create_index("ix_production_boms_design_bom_id", ["design_bom_id"])
        if "design_bom_revision_id" not in cols:
            b.add_column(sa.Column("design_bom_revision_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_production_boms_design_bom_revision_id", "design_bom_revisions", ["design_bom_revision_id"], ["id"])
            b.create_index("ix_production_boms_design_bom_revision_id", ["design_bom_revision_id"])
        if "design_revision_label" not in cols:
            b.add_column(sa.Column("design_revision_label", sa.String(length=10), nullable=True))
        if "transferred_at" not in cols:
            b.add_column(sa.Column("transferred_at", sa.DateTime(timezone=True), nullable=True))
        if "transferred_by_id" not in cols:
            b.add_column(sa.Column("transferred_by_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_production_boms_transferred_by_id", "users", ["transferred_by_id"], ["id"])

    if "make_buy" not in _cols(insp, "production_bom_items"):
        with op.batch_alter_table("production_bom_items") as b:
            b.add_column(sa.Column("make_buy", sa.String(length=10), nullable=True))

    if "cost_relieved" not in _cols(insp, "production_work_orders"):
        with op.batch_alter_table("production_work_orders") as b:
            b.add_column(sa.Column("cost_relieved", sa.Float(), nullable=False, server_default="0"))

    if "activity_rate" not in _cols(insp, "production_time_logs"):
        with op.batch_alter_table("production_time_logs") as b:
            b.add_column(sa.Column("activity_rate", sa.Float(), nullable=True))

    cols = _cols(insp, "inventory_valuation_lines")
    with op.batch_alter_table("inventory_valuation_lines") as b:
        if "line_kind" not in cols:
            b.add_column(sa.Column("line_kind", sa.String(length=10), nullable=False, server_default="stock"))
        if "work_order_id" not in cols:
            b.add_column(sa.Column("work_order_id", sa.Integer(), nullable=True))
            b.create_foreign_key("fk_inventory_valuation_lines_work_order_id", "production_work_orders", ["work_order_id"], ["id"])

    if not insp.has_table("production_order_cost_postings"):
        op.create_table(
            "production_order_cost_postings",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("production_work_orders.id"), nullable=False),
            sa.Column("posting_type", sa.String(length=20), nullable=False),
            sa.Column("posting_date", sa.Date(), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False, server_default="0"),
            sa.Column("unit_cost", sa.Float(), nullable=False, server_default="0"),
            sa.Column("amount", sa.Float(), nullable=False, server_default="0"),
            sa.Column("cost_source", sa.String(length=20), nullable=True),
            sa.Column("stock_transaction_id", sa.Integer(), sa.ForeignKey("store_stock_transactions.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_production_order_cost_postings_work_order_id", "production_order_cost_postings", ["work_order_id"])
        op.create_index("ix_production_order_cost_postings_posting_date", "production_order_cost_postings", ["posting_date"])

        # Backfill: every Store ledger row a work order posted so far.
        # issue -> material_issue, return_in -> material_return, receipt -> goods_receipt.
        bind.execute(sa.text("""
            INSERT INTO production_order_cost_postings
                (work_order_id, posting_type, posting_date, item_id, quantity, unit_cost, amount, cost_source,
                 stock_transaction_id, remarks, created_by_id, created_at, updated_at)
            SELECT wo.id,
                   CASE t.transaction_type WHEN 'issue' THEN 'material_issue'
                                           WHEN 'return_in' THEN 'material_return' ELSE 'goods_receipt' END,
                   t.transaction_date, t.item_id, t.quantity,
                   CASE WHEN t.value IS NOT NULL AND t.quantity > 0 THEN t.value / t.quantity
                        ELSE COALESCE(NULLIF(i.standard_cost, 0), i.moving_average_cost, 0) END,
                   CASE WHEN t.value IS NOT NULL THEN t.value
                        ELSE t.quantity * COALESCE(NULLIF(i.standard_cost, 0), i.moving_average_cost, 0) END,
                   CASE WHEN t.value IS NOT NULL THEN 'ledger' ELSE 'item_cost' END,
                   t.id, 'Backfilled from the Store ledger', t.created_by_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM store_stock_transactions t
            JOIN production_work_orders wo ON wo.wo_number = t.reference_number
            JOIN store_items i ON i.id = t.item_id
            WHERE t.reference_type = 'work_order' AND t.transaction_type IN ('issue', 'return_in', 'receipt')
        """))
        bind.execute(sa.text("""
            UPDATE production_work_orders SET cost_relieved = COALESCE((
                SELECT SUM(p.amount) FROM production_order_cost_postings p
                WHERE p.work_order_id = production_work_orders.id AND p.posting_type = 'goods_receipt'), 0)
        """))


def downgrade():
    op.drop_index("ix_production_order_cost_postings_posting_date", table_name="production_order_cost_postings")
    op.drop_index("ix_production_order_cost_postings_work_order_id", table_name="production_order_cost_postings")
    op.drop_table("production_order_cost_postings")
    with op.batch_alter_table("inventory_valuation_lines") as b:
        b.drop_constraint("fk_inventory_valuation_lines_work_order_id", type_="foreignkey")
        b.drop_column("work_order_id")
        b.drop_column("line_kind")
    with op.batch_alter_table("production_time_logs") as b:
        b.drop_column("activity_rate")
    with op.batch_alter_table("production_work_orders") as b:
        b.drop_column("cost_relieved")
    with op.batch_alter_table("production_bom_items") as b:
        b.drop_column("make_buy")
    with op.batch_alter_table("production_boms") as b:
        b.drop_constraint("fk_production_boms_transferred_by_id", type_="foreignkey")
        b.drop_column("transferred_by_id")
        b.drop_column("transferred_at")
        b.drop_column("design_revision_label")
        b.drop_index("ix_production_boms_design_bom_revision_id")
        b.drop_constraint("fk_production_boms_design_bom_revision_id", type_="foreignkey")
        b.drop_column("design_bom_revision_id")
        b.drop_index("ix_production_boms_design_bom_id")
        b.drop_constraint("fk_production_boms_design_bom_id", type_="foreignkey")
        b.drop_column("design_bom_id")

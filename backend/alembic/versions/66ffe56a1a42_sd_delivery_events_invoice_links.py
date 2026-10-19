"""SD: delivery events against the SO schedule (VL01N/PGI/POD), SO <-> AR
invoice links (VF01) and the billing-due handoff (VF04).

- sales_delivery_events (dispatch / delivery / commissioning per schedule row)
- sales_invoice_links (AR invoice line <-> SO line / billing milestone / row)
- sales_order_schedules: qty_dispatched, qty_delivered, dispatch_reference,
  delivery_reference, commissioning_reference
- sales_billing_plan_lines: invoice_requested_at, invoice_requested_by_id

Revision ID: 66ffe56a1a42
Revises: 7523fd99f61e
"""
from alembic import op
import sqlalchemy as sa

revision = "66ffe56a1a42"
down_revision = "7523fd99f61e"
branch_labels = None
depends_on = None

QTY = sa.Numeric(18, 4, asdecimal=False)
MONEY = sa.Numeric(18, 2, asdecimal=False)


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _tables()
    if "sales_delivery_events" not in tables:
        op.create_table(
            "sales_delivery_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("so_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("schedule_id", sa.Integer(), sa.ForeignKey("sales_order_schedules.id"), nullable=False),
            sa.Column("so_line_id", sa.Integer(), sa.ForeignKey("sales_order_lines.id"), nullable=False),
            sa.Column("event", sa.String(20), nullable=False),
            sa.Column("quantity", QTY, nullable=False, server_default="1"),
            sa.Column("event_date", sa.Date(), nullable=False),
            sa.Column("reference", sa.String(150), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
            sa.Column("material_issue_id", sa.Integer(), sa.ForeignKey("store_material_issues.id"), nullable=True),
            sa.Column("rrv_build_id", sa.Integer(), sa.ForeignKey("production_rrv_builds.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reversed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reverse_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )
        op.create_index("ix_sales_delivery_events_so_id", "sales_delivery_events", ["so_id"])
        op.create_index("ix_sales_delivery_events_schedule_id", "sales_delivery_events", ["schedule_id"])
        op.create_index("ix_sales_delivery_events_material_issue_id", "sales_delivery_events", ["material_issue_id"])
    if "sales_invoice_links" not in tables:
        op.create_table(
            "sales_invoice_links",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ar_transaction_id", sa.Integer(), sa.ForeignKey("ar_transactions.id"), nullable=False),
            sa.Column("ar_transaction_line_id", sa.Integer(), sa.ForeignKey("ar_transaction_lines.id"), nullable=True),
            sa.Column("so_id", sa.Integer(), sa.ForeignKey("sales_orders.id"), nullable=False),
            sa.Column("so_line_id", sa.Integer(), sa.ForeignKey("sales_order_lines.id"), nullable=False),
            sa.Column("billing_plan_line_id", sa.Integer(), sa.ForeignKey("sales_billing_plan_lines.id"), nullable=False),
            sa.Column("schedule_id", sa.Integer(), sa.ForeignKey("sales_order_schedules.id"), nullable=True),
            sa.Column("quantity", QTY, nullable=False, server_default="0"),
            sa.Column("taxable_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("gst_amount", MONEY, nullable=False, server_default="0"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )
        for col in ("ar_transaction_id", "so_id", "so_line_id", "billing_plan_line_id", "schedule_id"):
            op.create_index(f"ix_sales_invoice_links_{col}", "sales_invoice_links", [col])

    cols = _columns("sales_order_schedules")
    with op.batch_alter_table("sales_order_schedules") as b:
        if "qty_dispatched" not in cols:
            b.add_column(sa.Column("qty_dispatched", QTY, nullable=False, server_default="0"))
        if "qty_delivered" not in cols:
            b.add_column(sa.Column("qty_delivered", QTY, nullable=False, server_default="0"))
        for name in ("dispatch_reference", "delivery_reference", "commissioning_reference"):
            if name not in cols:
                b.add_column(sa.Column(name, sa.String(150), nullable=True))

    cols = _columns("sales_billing_plan_lines")
    with op.batch_alter_table("sales_billing_plan_lines") as b:
        if "invoice_requested_at" not in cols:
            b.add_column(sa.Column("invoice_requested_at", sa.DateTime(timezone=True), nullable=True))
        if "invoice_requested_by_id" not in cols:
            b.add_column(sa.Column("invoice_requested_by_id", sa.Integer(), sa.ForeignKey("users.id",
                                   name="fk_sales_billing_plan_lines_invoice_requested_by_id_users"), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sales_billing_plan_lines") as b:
        b.drop_constraint("fk_sales_billing_plan_lines_invoice_requested_by_id_users", type_="foreignkey")
        b.drop_column("invoice_requested_by_id")
        b.drop_column("invoice_requested_at")
    with op.batch_alter_table("sales_order_schedules") as b:
        for name in ("commissioning_reference", "delivery_reference", "dispatch_reference", "qty_delivered", "qty_dispatched"):
            b.drop_column(name)
    op.drop_table("sales_invoice_links")
    op.drop_table("sales_delivery_events")

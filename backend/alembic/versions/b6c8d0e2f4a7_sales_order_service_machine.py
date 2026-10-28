"""Service sales orders: the machine and its SRs.

New column sales_orders.service_machine_id (FK erp_projects, nullable) and new
table sales_order_service_requests (order ↔ SR). Nothing existing changes.

Revision ID: b6c8d0e2f4a7
Revises: a3d5e7f9c1b2
"""
from alembic import op
import sqlalchemy as sa

revision = "b6c8d0e2f4a7"
down_revision = "a3d5e7f9c1b2"
branch_labels = None
depends_on = None


def upgrade():
    insp = sa.inspect(op.get_bind())
    cols = {c["name"] for c in insp.get_columns("sales_orders")}
    if "service_machine_id" not in cols:
        op.add_column("sales_orders", sa.Column("service_machine_id", sa.Integer(), nullable=True))
        op.create_foreign_key("fk_sales_orders_service_machine", "sales_orders", "erp_projects", ["service_machine_id"], ["id"], ondelete="SET NULL")
        op.create_index("ix_sales_orders_service_machine_id", "sales_orders", ["service_machine_id"])
    if not insp.has_table("sales_order_service_requests"):
        op.create_table(
            "sales_order_service_requests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("so_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("service_request_id", sa.Integer(), sa.ForeignKey("erp_service_requests.id", ondelete="CASCADE"), nullable=False),
            sa.UniqueConstraint("so_id", "service_request_id", name="uq_so_service_request"),
        )
        op.create_index("ix_sales_order_service_requests_so_id", "sales_order_service_requests", ["so_id"])
        op.create_index("ix_sales_order_service_requests_service_request_id", "sales_order_service_requests", ["service_request_id"])


def downgrade():
    op.drop_table("sales_order_service_requests")
    op.drop_index("ix_sales_orders_service_machine_id", table_name="sales_orders")
    op.drop_constraint("fk_sales_orders_service_machine", "sales_orders", type_="foreignkey")
    op.drop_column("sales_orders", "service_machine_id")

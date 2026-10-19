"""Sales: Order Projects (OP-YYYY-NNN) — the execution project of a confirmed
sales order, with one element per RRV vehicle and one lot per spares / other
line (2026-10-17). Schema only — existing confirmed orders get their projects
from the admin "Create projects for confirmed orders" button.

Revision ID: d7a3c9e1f548
Revises: c4e8a2f6b913
"""
from alembic import op
import sqlalchemy as sa

revision = "d7a3c9e1f548"
down_revision = "c4e8a2f6b913"
branch_labels = None
depends_on = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    ]


def upgrade() -> None:
    if not _has_table("sales_order_projects"):
        op.create_table(
            "sales_order_projects",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("op_number", sa.String(30), nullable=False),
            sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id"), nullable=False),
            sa.Column("customer_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=True),
            sa.Column("customer_name", sa.String(255), nullable=True),
            sa.Column("title", sa.String(400), nullable=False),
            sa.Column("project_manager_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("planned_start", sa.Date(), nullable=True),
            sa.Column("planned_end", sa.Date(), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_sales_order_projects_op_number", "sales_order_projects", ["op_number"], unique=True)
        op.create_index("ix_sales_order_projects_sales_order_id", "sales_order_projects", ["sales_order_id"], unique=True)
        op.create_index("ix_sales_order_projects_customer_id", "sales_order_projects", ["customer_id"])
        op.create_index("ix_sales_order_projects_status", "sales_order_projects", ["status"])
    if not _has_table("sales_order_project_elements"):
        op.create_table(
            "sales_order_project_elements",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("order_project_id", sa.Integer(), sa.ForeignKey("sales_order_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("element_no", sa.String(40), nullable=False),
            sa.Column("kind", sa.String(10), nullable=False),
            sa.Column("label", sa.String(255), nullable=False),
            sa.Column("sales_order_line_id", sa.Integer(), sa.ForeignKey("sales_order_lines.id"), nullable=False),
            sa.Column("sales_schedule_id", sa.Integer(), sa.ForeignKey("sales_order_schedules.id"), nullable=True),
            sa.Column("quantity", sa.Numeric(18, 4), nullable=False, server_default="1"),
            sa.Column("contractual_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="planned"),
            *_ts(),
            sa.UniqueConstraint("order_project_id", "element_no", name="uq_sales_op_element_no"),
        )
        for col in ("order_project_id", "element_no", "sales_order_line_id", "sales_schedule_id", "status"):
            op.create_index(f"ix_sales_order_project_elements_{col}", "sales_order_project_elements", [col])


def downgrade() -> None:
    if _has_table("sales_order_project_elements"):
        op.drop_table("sales_order_project_elements")
    if _has_table("sales_order_projects"):
        op.drop_table("sales_order_projects")

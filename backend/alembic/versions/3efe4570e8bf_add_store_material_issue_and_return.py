"""add store material issue and material return

Revision ID: 3efe4570e8bf
Revises: 101e320829cb
Create Date: 2026-09-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "3efe4570e8bf"
down_revision = "101e320829cb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "store_material_issues" not in tables:
        op.create_table(
            "store_material_issues",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("issue_number", sa.String(length=50), nullable=False, unique=True),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
            sa.Column("project_or_work_order", sa.String(length=150), nullable=True),
            sa.Column("issue_date", sa.Date(), nullable=False),
            sa.Column("issued_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_store_material_issues_issue_number", "store_material_issues", ["issue_number"], unique=True)

    if "store_material_issue_items" not in tables:
        op.create_table(
            "store_material_issue_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("issue_id", sa.Integer(), sa.ForeignKey("store_material_issues.id"), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("batch_number", sa.String(length=100), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "store_material_returns" not in tables:
        op.create_table(
            "store_material_returns",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("return_number", sa.String(length=50), nullable=False, unique=True),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("source_type", sa.String(length=20), nullable=False, server_default="issue"),
            sa.Column("source_issue_id", sa.Integer(), sa.ForeignKey("store_material_issues.id"), nullable=True),
            sa.Column("source_description", sa.String(length=255), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("return_date", sa.Date(), nullable=False),
            sa.Column("returned_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_store_material_returns_return_number", "store_material_returns", ["return_number"], unique=True)

    if "store_material_return_items" not in tables:
        op.create_table(
            "store_material_return_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("return_id", sa.Integer(), sa.ForeignKey("store_material_returns.id"), nullable=False),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False),
            sa.Column("condition", sa.String(length=20), nullable=False, server_default="good"),
            sa.Column("batch_number", sa.String(length=100), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    op.drop_table("store_material_return_items")
    op.drop_table("store_material_returns")
    op.drop_table("store_material_issue_items")
    op.drop_table("store_material_issues")

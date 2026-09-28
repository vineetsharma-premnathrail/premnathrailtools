"""expand branch (plant) master with address/user/document lists, a new cost
center master, and branch-scoped warehouses

Revision ID: b2d4f6a8c0e3
Revises: a1c3e5f7b9d2
Create Date: 2026-09-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b2d4f6a8c0e3'
down_revision = 'a1c3e5f7b9d2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "cost_centers" not in existing_tables:
        op.create_table(
            "cost_centers",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("code", sa.String(length=30), nullable=False, unique=True),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("cost_center_type", sa.String(length=100), nullable=True),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
            sa.Column("head_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("parent_cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=True),
            sa.Column("effective_from", sa.Date(), nullable=True),
            sa.Column("effective_to", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "branch_addresses" not in existing_tables:
        op.create_table(
            "branch_addresses",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=False),
            sa.Column("address_type", sa.String(length=50), nullable=True),
            sa.Column("address_line1", sa.Text(), nullable=False),
            sa.Column("address_line2", sa.Text(), nullable=True),
            sa.Column("landmark", sa.String(length=150), nullable=True),
            sa.Column("country", sa.String(length=100), nullable=True),
            sa.Column("state", sa.String(length=100), nullable=True),
            sa.Column("city", sa.String(length=100), nullable=True),
            sa.Column("district", sa.String(length=100), nullable=True),
            sa.Column("pincode", sa.String(length=10), nullable=True),
            sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "branch_user_assignments" not in existing_tables:
        op.create_table(
            "branch_user_assignments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("employee_id", sa.String(length=50), nullable=True),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
            sa.Column("designation", sa.String(length=100), nullable=True),
            sa.Column("role", sa.String(length=100), nullable=True),
            sa.Column("access_level", sa.String(length=50), nullable=True),
            sa.Column("is_primary_branch", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("additional_branch_access", sa.JSON(), nullable=True),
            sa.Column("effective_from", sa.Date(), nullable=True),
            sa.Column("effective_to", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "branch_documents" not in existing_tables:
        op.create_table(
            "branch_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=False),
            sa.Column("document_type", sa.String(length=50), nullable=False),
            sa.Column("document_name", sa.String(length=200), nullable=False),
            sa.Column("document_number", sa.String(length=100), nullable=True),
            sa.Column("issue_date", sa.Date(), nullable=True),
            sa.Column("expiry_date", sa.Date(), nullable=True),
            sa.Column("issuing_authority", sa.String(length=150), nullable=True),
            sa.Column("version", sa.String(length=30), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=True),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=255), nullable=True),
            sa.Column("size", sa.Integer(), nullable=True),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(length=1000), nullable=True),
            sa.Column("confidentiality", sa.String(length=30), nullable=True),
            sa.Column("tags", sa.JSON(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    branch_columns = {c["name"] for c in inspector.get_columns("branches")}
    if "industry_function" not in branch_columns:
        op.add_column("branches", sa.Column("industry_function", sa.String(length=100), nullable=True))
    if "default_profit_center" not in branch_columns:
        op.add_column("branches", sa.Column("default_profit_center", sa.String(length=100), nullable=True))
    if "working_days" not in branch_columns:
        op.add_column("branches", sa.Column("working_days", sa.String(length=100), nullable=True))
    if "working_hours" not in branch_columns:
        op.add_column("branches", sa.Column("working_hours", sa.String(length=100), nullable=True))
    if "default_cost_center_id" not in branch_columns:
        op.add_column("branches", sa.Column("default_cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=True))
    for col in ["default_cost_center", "address", "address_line2", "city", "state", "country", "pincode", "email", "phone"]:
        if col in branch_columns:
            op.drop_column("branches", col)

    location_columns = {c["name"] for c in inspector.get_columns("store_locations")}
    if "branch_id" not in location_columns:
        op.add_column("store_locations", sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True))
    if "warehouse_type" not in location_columns:
        op.add_column("store_locations", sa.Column("warehouse_type", sa.String(length=100), nullable=True))
    if "manager_user_id" not in location_columns:
        op.add_column("store_locations", sa.Column("manager_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    if "storage_type" not in location_columns:
        op.add_column("store_locations", sa.Column("storage_type", sa.String(length=100), nullable=True))
    if "inventory_type" not in location_columns:
        op.add_column("store_locations", sa.Column("inventory_type", sa.String(length=100), nullable=True))
    if "operating_hours" not in location_columns:
        op.add_column("store_locations", sa.Column("operating_hours", sa.String(length=150), nullable=True))
    if "status" not in location_columns:
        op.add_column("store_locations", sa.Column("status", sa.String(length=30), nullable=False, server_default="active"))


def downgrade() -> None:
    op.drop_column("store_locations", "status")
    op.drop_column("store_locations", "operating_hours")
    op.drop_column("store_locations", "inventory_type")
    op.drop_column("store_locations", "storage_type")
    op.drop_column("store_locations", "manager_user_id")
    op.drop_column("store_locations", "warehouse_type")
    op.drop_column("store_locations", "branch_id")

    op.add_column("branches", sa.Column("phone", sa.String(length=30), nullable=True))
    op.add_column("branches", sa.Column("email", sa.String(length=150), nullable=True))
    op.add_column("branches", sa.Column("pincode", sa.String(length=20), nullable=True))
    op.add_column("branches", sa.Column("country", sa.String(length=100), nullable=True))
    op.add_column("branches", sa.Column("state", sa.String(length=100), nullable=True))
    op.add_column("branches", sa.Column("city", sa.String(length=100), nullable=True))
    op.add_column("branches", sa.Column("address_line2", sa.Text(), nullable=True))
    op.add_column("branches", sa.Column("address", sa.Text(), nullable=True))
    op.drop_column("branches", "default_cost_center_id")
    op.add_column("branches", sa.Column("default_cost_center", sa.String(length=100), nullable=True))
    op.drop_column("branches", "working_hours")
    op.drop_column("branches", "working_days")
    op.drop_column("branches", "default_profit_center")
    op.drop_column("branches", "industry_function")

    op.drop_table("branch_documents")
    op.drop_table("branch_user_assignments")
    op.drop_table("branch_addresses")
    op.drop_table("cost_centers")

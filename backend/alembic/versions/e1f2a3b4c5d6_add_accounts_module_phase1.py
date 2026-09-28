"""add accounts module phase 1 (master data)

Revision ID: e1f2a3b4c5d6
Revises: c1a2b3d4e5f6
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e1f2a3b4c5d6"
down_revision = "c1a2b3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "gl_accounts" not in existing_tables:
        op.create_table(
            "gl_accounts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(length=20), nullable=False, unique=True),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("account_type", sa.String(length=20), nullable=False),
            sa.Column("account_sub_type", sa.String(length=100), nullable=True),
            sa.Column("currency", sa.String(length=10), nullable=True, server_default="INR"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("opening_balance", sa.Float(), nullable=True, server_default="0"),
            sa.Column("is_posting_account", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("is_control_account", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "bank_accounts" not in existing_tables:
        op.create_table(
            "bank_accounts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("bank_name", sa.String(length=150), nullable=False),
            sa.Column("account_no", sa.String(length=50), nullable=False, unique=True),
            sa.Column("account_holder_name", sa.String(length=150), nullable=True),
            sa.Column("branch_name", sa.String(length=150), nullable=True),
            sa.Column("ifsc_code", sa.String(length=20), nullable=True),
            sa.Column("currency", sa.String(length=10), nullable=True, server_default="INR"),
            sa.Column("opening_balance", sa.Float(), nullable=False, server_default="0"),
            sa.Column("current_balance", sa.Float(), nullable=False, server_default="0"),
            sa.Column("gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "vendors" not in existing_tables:
        op.create_table(
            "vendors",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(length=30), nullable=False, unique=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("gstin", sa.String(length=20), nullable=True),
            sa.Column("pan", sa.String(length=15), nullable=True),
            sa.Column("address", sa.String(length=500), nullable=True),
            sa.Column("city", sa.String(length=100), nullable=True),
            sa.Column("state", sa.String(length=100), nullable=True),
            sa.Column("pin_code", sa.String(length=10), nullable=True),
            sa.Column("contact_name", sa.String(length=150), nullable=True),
            sa.Column("contact_phone", sa.String(length=30), nullable=True),
            sa.Column("contact_email", sa.String(length=150), nullable=True),
            sa.Column("bank_name", sa.String(length=150), nullable=True),
            sa.Column("bank_account_no", sa.String(length=50), nullable=True),
            sa.Column("ifsc_code", sa.String(length=20), nullable=True),
            sa.Column("account_holder_name", sa.String(length=150), nullable=True),
            sa.Column("credit_limit", sa.Float(), nullable=True),
            sa.Column("payment_days", sa.Integer(), nullable=True),
            sa.Column("early_payment_discount_pct", sa.Float(), nullable=True),
            sa.Column("gl_reconciliation_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    if "internal_orders" not in existing_tables:
        op.create_table(
            "internal_orders",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("code", sa.String(length=30), nullable=False, unique=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("order_type", sa.String(length=20), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("budgeted_amount", sa.Float(), nullable=True),
            sa.Column("gl_account_id", sa.Integer(), sa.ForeignKey("gl_accounts.id"), nullable=True),
            sa.Column("cost_center_id", sa.Integer(), sa.ForeignKey("cost_centers.id"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    # Additive columns on existing tables.
    cost_center_columns = {c["name"] for c in inspector.get_columns("cost_centers")}
    with op.batch_alter_table("cost_centers") as batch_op:
        if "annual_budget" not in cost_center_columns:
            batch_op.add_column(sa.Column("annual_budget", sa.Float(), nullable=True))
        if "budget_period" not in cost_center_columns:
            batch_op.add_column(sa.Column("budget_period", sa.String(length=7), nullable=True))
        if "gl_account_id" not in cost_center_columns:
            batch_op.add_column(sa.Column("gl_account_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key("fk_cost_centers_gl_account_id", "gl_accounts", ["gl_account_id"], ["id"])

    org_columns = {c["name"] for c in inspector.get_columns("crm_organizations")}
    with op.batch_alter_table("crm_organizations") as batch_op:
        if "credit_limit" not in org_columns:
            batch_op.add_column(sa.Column("credit_limit", sa.Float(), nullable=True))
        if "credit_days" not in org_columns:
            batch_op.add_column(sa.Column("credit_days", sa.Integer(), nullable=True))
        if "discount_percentage" not in org_columns:
            batch_op.add_column(sa.Column("discount_percentage", sa.Float(), nullable=True))
        if "gl_reconciliation_account_id" not in org_columns:
            batch_op.add_column(sa.Column("gl_reconciliation_account_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key("fk_crm_organizations_gl_reconciliation_account_id", "gl_accounts", ["gl_reconciliation_account_id"], ["id"])

    user_columns = {c["name"] for c in inspector.get_columns("users")}
    if "is_finance_manager" not in user_columns:
        op.add_column("users", sa.Column("is_finance_manager", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Register the new app in the admin's assignable-modules checklist.
    conn = op.get_bind()
    if inspector.has_table("modules") and conn.execute(
        sa.text("SELECT 1 FROM modules WHERE key = :key"), {"key": "accounts"}
    ).first() is None:
        conn.execute(
            sa.text(
                "INSERT INTO modules (key, label, icon, description, is_active, sort_order, created_at, updated_at) "
                "VALUES (:key, :label, :icon, :description, true, "
                "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM modules), now(), now())"
            ),
            {"key": "accounts", "label": "Finance & Accounting", "icon": "finance", "description": "GL, AP/AR, cost centers, and financial reporting."},
        )


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM modules WHERE key = 'accounts'"))

    inspector = sa.inspect(op.get_bind())
    user_columns = {c["name"] for c in inspector.get_columns("users")}
    if "is_finance_manager" in user_columns:
        op.drop_column("users", "is_finance_manager")

    org_columns = {c["name"] for c in inspector.get_columns("crm_organizations")}
    with op.batch_alter_table("crm_organizations") as batch_op:
        if "gl_reconciliation_account_id" in org_columns:
            batch_op.drop_constraint("fk_crm_organizations_gl_reconciliation_account_id", type_="foreignkey")
            batch_op.drop_column("gl_reconciliation_account_id")
        if "discount_percentage" in org_columns:
            batch_op.drop_column("discount_percentage")
        if "credit_days" in org_columns:
            batch_op.drop_column("credit_days")
        if "credit_limit" in org_columns:
            batch_op.drop_column("credit_limit")

    cost_center_columns = {c["name"] for c in inspector.get_columns("cost_centers")}
    with op.batch_alter_table("cost_centers") as batch_op:
        if "gl_account_id" in cost_center_columns:
            batch_op.drop_constraint("fk_cost_centers_gl_account_id", type_="foreignkey")
            batch_op.drop_column("gl_account_id")
        if "budget_period" in cost_center_columns:
            batch_op.drop_column("budget_period")
        if "annual_budget" in cost_center_columns:
            batch_op.drop_column("annual_budget")

    for table in ("internal_orders", "vendors", "bank_accounts", "gl_accounts"):
        if inspector.has_table(table):
            op.drop_table(table)

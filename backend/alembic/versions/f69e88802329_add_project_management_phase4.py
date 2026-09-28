"""add project management phase4

Revision ID: f69e88802329
Revises: 51378ba59e9a
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "f69e88802329"
down_revision = "51378ba59e9a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "pm_project_issues" not in existing_tables:
        op.create_table(
            "pm_project_issues",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("severity", sa.String(length=20), nullable=False, server_default="medium"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("raised_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("raised_date", sa.Date(), nullable=False),
            sa.Column("resolved_date", sa.Date(), nullable=True),
            sa.Column("resolution", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_pm_project_issues_project_id", "pm_project_issues", ["project_id"])

    if "pm_project_risks" not in existing_tables:
        op.create_table(
            "pm_project_risks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("probability", sa.String(length=10), nullable=False, server_default="medium"),
            sa.Column("impact", sa.String(length=10), nullable=False, server_default="medium"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="identified"),
            sa.Column("mitigation_plan", sa.Text(), nullable=True),
            sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_pm_project_risks_project_id", "pm_project_risks", ["project_id"])

    if "pm_project_change_requests" not in existing_tables:
        op.create_table(
            "pm_project_change_requests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("impact_assessment", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="submitted"),
            sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_pm_project_change_requests_project_id", "pm_project_change_requests", ["project_id"])

    if "pm_project_approvals" not in existing_tables:
        op.create_table(
            "pm_project_approvals",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("approval_type", sa.String(length=30), nullable=False),
            # Polymorphic reference (change_request/budget_line/etc. id depending on
            # approval_type) — intentionally NOT a hard foreign key, same pattern as
            # store_stock_transactions.reference_number.
            sa.Column("reference_id", sa.Integer(), nullable=True),
            sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("comments", sa.Text(), nullable=True),
            sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_pm_project_approvals_project_id", "pm_project_approvals", ["project_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    # None of these four tables reference each other, so any order is safe.
    if "pm_project_approvals" in existing_tables:
        op.drop_index("ix_pm_project_approvals_project_id", table_name="pm_project_approvals")
        op.drop_table("pm_project_approvals")
    if "pm_project_change_requests" in existing_tables:
        op.drop_index("ix_pm_project_change_requests_project_id", table_name="pm_project_change_requests")
        op.drop_table("pm_project_change_requests")
    if "pm_project_risks" in existing_tables:
        op.drop_index("ix_pm_project_risks_project_id", table_name="pm_project_risks")
        op.drop_table("pm_project_risks")
    if "pm_project_issues" in existing_tables:
        op.drop_index("ix_pm_project_issues_project_id", table_name="pm_project_issues")
        op.drop_table("pm_project_issues")

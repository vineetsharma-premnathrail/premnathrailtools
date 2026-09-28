"""add project management phase3

Revision ID: 51378ba59e9a
Revises: babf5e1cadcf
Create Date: 2026-09-25

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "51378ba59e9a"
down_revision = "babf5e1cadcf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "pm_project_budget_lines" not in existing_tables:
        op.create_table(
            "pm_project_budget_lines",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("category", sa.String(length=150), nullable=False),
            sa.Column("budgeted_amount", sa.Float(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_pm_project_budget_lines_project_id", "pm_project_budget_lines", ["project_id"])

    if "pm_project_cost_entries" not in existing_tables:
        op.create_table(
            "pm_project_cost_entries",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("budget_line_id", sa.Integer(), sa.ForeignKey("pm_project_budget_lines.id"), nullable=True),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("cost_date", sa.Date(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("recorded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_pm_project_cost_entries_project_id", "pm_project_cost_entries", ["project_id"])

    if "pm_project_deliverables" not in existing_tables:
        op.create_table(
            "pm_project_deliverables",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("milestone_id", sa.Integer(), sa.ForeignKey("pm_project_milestones.id"), nullable=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="not_started"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index("ix_pm_project_deliverables_project_id", "pm_project_deliverables", ["project_id"])

    if "pm_project_documents" not in existing_tables:
        op.create_table(
            "pm_project_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("pm_projects.id"), nullable=False),
            sa.Column("doc_type", sa.String(length=30), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("version", sa.String(length=20), nullable=True),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("file_path", sa.String(length=1000), nullable=False),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(length=1000), nullable=True),
            sa.Column("file_size", sa.Integer(), nullable=True),
            sa.Column("mime_type", sa.String(length=255), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("uploaded_by_name", sa.String(length=150), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_pm_project_documents_project_id", "pm_project_documents", ["project_id"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    # Dependency-safe order: cost_entries references budget_lines, so drop
    # cost_entries first.
    if "pm_project_documents" in existing_tables:
        op.drop_index("ix_pm_project_documents_project_id", table_name="pm_project_documents")
        op.drop_table("pm_project_documents")
    if "pm_project_deliverables" in existing_tables:
        op.drop_index("ix_pm_project_deliverables_project_id", table_name="pm_project_deliverables")
        op.drop_table("pm_project_deliverables")
    if "pm_project_cost_entries" in existing_tables:
        op.drop_index("ix_pm_project_cost_entries_project_id", table_name="pm_project_cost_entries")
        op.drop_table("pm_project_cost_entries")
    if "pm_project_budget_lines" in existing_tables:
        op.drop_index("ix_pm_project_budget_lines_project_id", table_name="pm_project_budget_lines")
        op.drop_table("pm_project_budget_lines")

"""add project management phase1

Revision ID: 2d964a9b3fa4
Revises: 820d29910012
Create Date: 2026-09-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "2d964a9b3fa4"
down_revision = "820d29910012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "pm_projects" not in tables:
        op.create_table(
            "pm_projects",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_code", sa.String(length=50), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("scope_statement", sa.Text(), nullable=True),
            sa.Column("objectives", sa.Text(), nullable=True),
            sa.Column("client_name", sa.String(length=255), nullable=True),
            sa.Column("project_type", sa.String(length=100), nullable=True),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id"), nullable=True),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="planning"),
            sa.Column("priority", sa.String(length=20), nullable=False, server_default="medium"),
            sa.Column("project_manager_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("sponsor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("closure_date", sa.Date(), nullable=True),
            sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("final_status", sa.String(length=20), nullable=True),
            sa.Column("lessons_learned", sa.Text(), nullable=True),
            sa.Column("client_signoff", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("closure_report", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("project_code", name="uq_pm_projects_project_code"),
        )
        op.create_index("ix_pm_projects_project_code", "pm_projects", ["project_code"])


def downgrade() -> None:
    op.drop_table("pm_projects")

"""Link existing R&D (Prototype / Research) projects to CRM requirements.

Revision ID: f2c6e8a4b1d7
Revises: e3b7d1f9a2c4
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "f2c6e8a4b1d7"
down_revision = "e3b7d1f9a2c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "rnd_requirement_project_links" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "rnd_requirement_project_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False, index=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("rnd_projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("linked_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("source", "record_id", "project_id", name="uq_rnd_requirement_project_link"),
    )


def downgrade() -> None:
    op.drop_table("rnd_requirement_project_links")

"""PM project closure: technically-complete date, documents-archived
confirmation and lessons learned (closure checklist + Final Project Report).

Revision ID: e8b2d4f6a1c3
Revises: d5f1a7c3e9b2
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "e8b2d4f6a1c3"
down_revision = "d5f1a7c3e9b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("pm_projects")}
    if "technically_completed_on" not in cols:
        op.add_column("pm_projects", sa.Column("technically_completed_on", sa.Date(), nullable=True))
    if "documents_archived_at" not in cols:
        op.add_column("pm_projects", sa.Column("documents_archived_at", sa.DateTime(timezone=True), nullable=True))
    if "documents_archived_by_id" not in cols:
        op.add_column("pm_projects", sa.Column("documents_archived_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    if "lessons_learned" not in cols:
        op.add_column("pm_projects", sa.Column("lessons_learned", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("pm_projects", "lessons_learned")
    op.drop_column("pm_projects", "documents_archived_by_id")
    op.drop_column("pm_projects", "documents_archived_at")
    op.drop_column("pm_projects", "technically_completed_on")

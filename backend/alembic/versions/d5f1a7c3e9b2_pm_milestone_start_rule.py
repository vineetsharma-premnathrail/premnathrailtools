"""PM milestones: start rule (parallel / overlapping steps) instead of a
strict top-to-bottom chain. Existing milestones keep the old behaviour
('after_previous').

Revision ID: d5f1a7c3e9b2
Revises: c9a4e2f7b1d3
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "d5f1a7c3e9b2"
down_revision = "c9a4e2f7b1d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("pm_project_milestones")}
    if "start_rule" not in cols:
        op.add_column("pm_project_milestones", sa.Column("start_rule", sa.String(20), nullable=False, server_default="after_previous"))


def downgrade() -> None:
    op.drop_column("pm_project_milestones", "start_rule")

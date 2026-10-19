"""CRM follow-ups: mom_revision, so a Word MoM made from an older version of
the follow-up is flagged as out of date

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("crm_activities")}
    if "mom_revision" not in columns:
        op.add_column("crm_activities", sa.Column("mom_revision", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("crm_activities", "mom_revision")

"""add subject to crm_activities

Revision ID: a1c3d9f7e2b4
Revises: ba8c1f32d2d3
Create Date: 2026-08-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a1c3d9f7e2b4'
down_revision = 'ba8c1f32d2d3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_activities")}
    if "subject" not in columns:
        op.add_column("crm_activities", sa.Column("subject", sa.String(length=255), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_activities")}
    if "subject" in columns:
        op.drop_column("crm_activities", "subject")

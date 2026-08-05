"""add activity_date to crm_activities

Revision ID: d3f6b1c9a2e4
Revises: a1c3e7f92b48
Create Date: 2026-08-04 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd3f6b1c9a2e4'
down_revision: Union[str, Sequence[str], None] = 'a1c3e7f92b48'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    existing_columns = {c["name"] for c in inspector.get_columns("crm_activities")}
    if "activity_date" not in existing_columns:
        op.add_column("crm_activities", sa.Column("activity_date", sa.Date(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("crm_activities", "activity_date")

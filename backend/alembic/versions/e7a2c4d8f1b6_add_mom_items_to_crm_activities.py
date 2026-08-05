"""add mom_items to crm_activities

Revision ID: e7a2c4d8f1b6
Revises: d3f6b1c9a2e4
Create Date: 2026-08-04 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7a2c4d8f1b6'
down_revision: Union[str, Sequence[str], None] = 'd3f6b1c9a2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    existing_columns = {c["name"] for c in inspector.get_columns("crm_activities")}
    if "mom_items" not in existing_columns:
        op.add_column("crm_activities", sa.Column("mom_items", sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("crm_activities", "mom_items")

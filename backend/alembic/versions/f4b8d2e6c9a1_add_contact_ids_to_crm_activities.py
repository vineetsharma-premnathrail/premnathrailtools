"""add contact_ids to crm_activities

Revision ID: f4b8d2e6c9a1
Revises: e7a2c4d8f1b6
Create Date: 2026-08-04 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4b8d2e6c9a1'
down_revision: Union[str, Sequence[str], None] = 'e7a2c4d8f1b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    existing_columns = {c["name"] for c in inspector.get_columns("crm_activities")}
    if "contact_ids" not in existing_columns:
        op.add_column("crm_activities", sa.Column("contact_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("crm_activities", "contact_ids")

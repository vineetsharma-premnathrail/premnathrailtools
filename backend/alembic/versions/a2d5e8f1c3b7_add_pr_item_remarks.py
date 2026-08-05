"""add remarks to purchase requisition items

Revision ID: a2d5e8f1c3b7
Revises: c9d4f7b2e8a1
Create Date: 2026-08-05 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2d5e8f1c3b7'
down_revision: Union[str, Sequence[str], None] = 'c9d4f7b2e8a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    existing_columns = {c["name"] for c in inspector.get_columns("purchase_requisition_items")}
    if "remarks" not in existing_columns:
        op.add_column("purchase_requisition_items", sa.Column("remarks", sa.String(length=1000), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("purchase_requisition_items", "remarks")

"""add priority, required_by_date, purchase_reason to purchase requisitions

Revision ID: e1f6a3c9b2d4
Revises: d8e4b2f6a9c1
Create Date: 2026-08-07 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f6a3c9b2d4'
down_revision: Union[str, Sequence[str], None] = 'd8e4b2f6a9c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    existing_columns = {c["name"] for c in inspector.get_columns("purchase_requisitions")}
    if "priority" not in existing_columns:
        op.add_column("purchase_requisitions", sa.Column("priority", sa.String(length=10), nullable=False, server_default="medium"))
    if "required_by_date" not in existing_columns:
        op.add_column("purchase_requisitions", sa.Column("required_by_date", sa.Date(), nullable=True))
    if "purchase_reason" not in existing_columns:
        op.add_column("purchase_requisitions", sa.Column("purchase_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("purchase_requisitions", "purchase_reason")
    op.drop_column("purchase_requisitions", "required_by_date")
    op.drop_column("purchase_requisitions", "priority")

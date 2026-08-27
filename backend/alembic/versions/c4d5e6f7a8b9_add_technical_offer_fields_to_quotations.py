"""add technical offer number/date fields to crm_quotations

Revision ID: c4d5e6f7a8b9
Revises: b2c3d4e5f6a7
Create Date: 2026-08-27 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_quotations")}
    if "technical_offer_number" not in columns:
        op.add_column("crm_quotations", sa.Column("technical_offer_number", sa.String(length=100), nullable=True))
    if "technical_offer_date" not in columns:
        op.add_column("crm_quotations", sa.Column("technical_offer_date", sa.Date(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("crm_quotations", "technical_offer_date")
    op.drop_column("crm_quotations", "technical_offer_number")

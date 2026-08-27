"""add technical offer request fields to crm_inquiries and crm_tenders

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-08-26 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())

    inq_columns = {c["name"] for c in inspector.get_columns("crm_inquiries")}
    if "technical_offer_number" not in inq_columns:
        op.add_column("crm_inquiries", sa.Column("technical_offer_number", sa.String(length=100), nullable=True))
    if "technical_offer_sent_at" not in inq_columns:
        op.add_column("crm_inquiries", sa.Column("technical_offer_sent_at", sa.DateTime(timezone=True), nullable=True))

    tnd_columns = {c["name"] for c in inspector.get_columns("crm_tenders")}
    if "technical_offer_number" not in tnd_columns:
        op.add_column("crm_tenders", sa.Column("technical_offer_number", sa.String(length=100), nullable=True))
    if "technical_offer_sent_at" not in tnd_columns:
        op.add_column("crm_tenders", sa.Column("technical_offer_sent_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("crm_tenders", "technical_offer_sent_at")
    op.drop_column("crm_tenders", "technical_offer_number")
    op.drop_column("crm_inquiries", "technical_offer_sent_at")
    op.drop_column("crm_inquiries", "technical_offer_number")

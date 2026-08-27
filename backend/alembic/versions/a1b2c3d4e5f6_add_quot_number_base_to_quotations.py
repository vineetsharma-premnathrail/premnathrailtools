"""add quot_number_base to crm_quotations

Revision ID: a1b2c3d4e5f6
Revises: d4e8f1a3b6c9
Create Date: 2026-08-26 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'd4e8f1a3b6c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_quotations")}

    if "quot_number_base" not in columns:
        op.add_column("crm_quotations", sa.Column("quot_number_base", sa.String(length=100), nullable=True))
        # Backfill: existing quot_number values already look like "QT-<suffix>" or
        # "QT-<suffix>-R<n>" (old revision scheme) — strip any "-R<n>" suffix to get the base.
        op.execute(
            "UPDATE crm_quotations SET quot_number_base = regexp_replace(quot_number, '-R[0-9]+$', '') "
            "WHERE quot_number IS NOT NULL"
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("crm_quotations", "quot_number_base")

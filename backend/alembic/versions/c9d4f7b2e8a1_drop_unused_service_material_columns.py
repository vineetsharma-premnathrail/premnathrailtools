"""drop unused service material columns (supplier, availability)

Revision ID: c9d4f7b2e8a1
Revises: b7c1e5a9d3f2
Create Date: 2026-08-05 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9d4f7b2e8a1'
down_revision: Union[str, Sequence[str], None] = 'b7c1e5a9d3f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    existing_columns = {c["name"] for c in inspector.get_columns("erp_service_materials")}
    if "supplier" in existing_columns:
        op.drop_column("erp_service_materials", "supplier")
    if "availability" in existing_columns:
        op.drop_column("erp_service_materials", "availability")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("erp_service_materials", sa.Column("availability", sa.String(length=50), server_default=sa.text("'in_stock'"), nullable=True))
    op.add_column("erp_service_materials", sa.Column("supplier", sa.String(length=255), nullable=True))

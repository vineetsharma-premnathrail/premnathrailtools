"""remove material pricing fields

Revision ID: 9b88ecb3688b
Revises: 96f882353283
Create Date: 2026-07-30 00:00:00.000000

Service Requests' Materials tab and the Purchase module both dropped cost
tracking (unit price / total price) — they're now quantity/receiving trackers
only, not a costing tool. Drops the now-unused columns from both tables.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9b88ecb3688b'
down_revision: Union[str, Sequence[str], None] = '96f882353283'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())

    def drop_column_if_exists(table: str, column: str) -> None:
        existing_columns = {c["name"] for c in inspector.get_columns(table)}
        if column in existing_columns:
            op.drop_column(table, column)

    drop_column_if_exists("erp_service_materials", "unit_price")
    drop_column_if_exists("erp_service_materials", "total_price")
    drop_column_if_exists("purchase_requisition_items", "unit_price")
    drop_column_if_exists("purchase_requisition_items", "total_price")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("purchase_requisition_items", sa.Column("total_price", sa.Float(), server_default=sa.text("0"), nullable=False))
    op.add_column("purchase_requisition_items", sa.Column("unit_price", sa.Float(), server_default=sa.text("0"), nullable=False))
    op.add_column("erp_service_materials", sa.Column("total_price", sa.Float(), server_default=sa.text("0"), nullable=False))
    op.add_column("erp_service_materials", sa.Column("unit_price", sa.Float(), server_default=sa.text("0"), nullable=False))

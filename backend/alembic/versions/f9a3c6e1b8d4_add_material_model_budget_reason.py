"""add model_number/estimated_budget/reason to erp_service_materials

Revision ID: f9a3c6e1b8d4
Revises: e7c1a9d4f256
Create Date: 2026-08-14 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f9a3c6e1b8d4'
down_revision: Union[str, Sequence[str], None] = 'e7c1a9d4f256'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("erp_service_materials")}

    if "model_number" not in columns:
        op.add_column("erp_service_materials", sa.Column("model_number", sa.String(length=100), nullable=True))
    if "estimated_budget" not in columns:
        op.add_column("erp_service_materials", sa.Column("estimated_budget", sa.Float(), nullable=True))
    if "reason" not in columns:
        op.add_column("erp_service_materials", sa.Column("reason", sa.String(length=500), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("erp_service_materials", "reason")
    op.drop_column("erp_service_materials", "estimated_budget")
    op.drop_column("erp_service_materials", "model_number")

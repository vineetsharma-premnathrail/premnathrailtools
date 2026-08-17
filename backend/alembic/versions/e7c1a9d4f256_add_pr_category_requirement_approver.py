"""add category/requirement type/approver to purchase_requisitions (SR-raised PRs)

Revision ID: e7c1a9d4f256
Revises: d4e8b2c7a913
Create Date: 2026-08-14 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7c1a9d4f256'
down_revision: Union[str, Sequence[str], None] = 'd4e8b2c7a913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("purchase_requisitions")}

    if "category_code" not in columns:
        op.add_column("purchase_requisitions", sa.Column("category_code", sa.String(length=10), nullable=True))
    if "requirement_type" not in columns:
        op.add_column("purchase_requisitions", sa.Column("requirement_type", sa.String(length=50), nullable=True))
    if "approver_id" not in columns:
        op.add_column("purchase_requisitions", sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
    if "approver_name" not in columns:
        op.add_column("purchase_requisitions", sa.Column("approver_name", sa.String(length=150), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("purchase_requisitions", "approver_name")
    op.drop_column("purchase_requisitions", "approver_id")
    op.drop_column("purchase_requisitions", "requirement_type")
    op.drop_column("purchase_requisitions", "category_code")

"""add item_id to pr_request_attachments (per-item attachments)

Revision ID: d4e8b2c7a913
Revises: c3d9a1f6b8e2
Create Date: 2026-08-14 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e8b2c7a913'
down_revision: Union[str, Sequence[str], None] = 'c3d9a1f6b8e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("pr_request_attachments")}

    if "item_id" not in columns:
        op.add_column(
            "pr_request_attachments",
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("pr_request_items.id"), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("pr_request_attachments", "item_id")

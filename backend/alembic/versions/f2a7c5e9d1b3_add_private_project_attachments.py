"""add is_private + attachment shares for project attachments

Revision ID: f2a7c5e9d1b3
Revises: e1f6a3c9b2d4
Create Date: 2026-08-12 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f2a7c5e9d1b3'
down_revision: Union[str, Sequence[str], None] = 'e1f6a3c9b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    existing_columns = {c["name"] for c in inspector.get_columns("erp_project_attachments")}
    if "is_private" not in existing_columns:
        op.add_column(
            "erp_project_attachments",
            sa.Column("is_private", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    if "erp_project_attachment_shares" not in inspector.get_table_names():
        op.create_table(
            "erp_project_attachment_shares",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "attachment_id",
                sa.Integer(),
                sa.ForeignKey("erp_project_attachments.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.UniqueConstraint("attachment_id", "user_id", name="uq_project_attachment_share"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("erp_project_attachment_shares")
    op.drop_column("erp_project_attachments", "is_private")

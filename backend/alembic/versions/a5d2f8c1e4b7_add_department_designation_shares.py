"""make attachment share user_id nullable, add department/designation columns

Revision ID: a5d2f8c1e4b7
Revises: f2a7c5e9d1b3
Create Date: 2026-08-12 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5d2f8c1e4b7'
down_revision: Union[str, Sequence[str], None] = 'f2a7c5e9d1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    existing_columns = {c["name"] for c in inspector.get_columns("erp_project_attachment_shares")}

    op.alter_column("erp_project_attachment_shares", "user_id", nullable=True)

    for uq in inspector.get_unique_constraints("erp_project_attachment_shares"):
        if uq["name"] == "uq_project_attachment_share":
            op.drop_constraint("uq_project_attachment_share", "erp_project_attachment_shares", type_="unique")

    if "department" not in existing_columns:
        op.add_column("erp_project_attachment_shares", sa.Column("department", sa.String(length=100), nullable=True))
    if "designation" not in existing_columns:
        op.add_column("erp_project_attachment_shares", sa.Column("designation", sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("erp_project_attachment_shares", "designation")
    op.drop_column("erp_project_attachment_shares", "department")
    op.create_unique_constraint("uq_project_attachment_share", "erp_project_attachment_shares", ["attachment_id", "user_id"])
    op.alter_column("erp_project_attachment_shares", "user_id", nullable=False)

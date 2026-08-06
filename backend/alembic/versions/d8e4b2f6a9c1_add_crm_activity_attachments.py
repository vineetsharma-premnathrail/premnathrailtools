"""add crm activity attachments

Revision ID: d8e4b2f6a9c1
Revises: a2d5e8f1c3b7
Create Date: 2026-08-05 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.db.base import Base


# revision identifiers, used by Alembic.
revision: str = 'd8e4b2f6a9c1'
down_revision: Union[str, Sequence[str], None] = 'a2d5e8f1c3b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Brand-new table (photo/file gallery per CRM Activity). Idempotent/checkfirst
    # like the other post-baseline "add a new table" migrations.
    Base.metadata.create_all(bind=op.get_bind(), tables=[
        Base.metadata.tables["crm_activity_attachments"],
    ])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("crm_activity_attachments")

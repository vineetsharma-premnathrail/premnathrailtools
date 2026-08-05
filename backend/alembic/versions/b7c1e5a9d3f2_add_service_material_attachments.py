"""add service material attachments

Revision ID: b7c1e5a9d3f2
Revises: f4b8d2e6c9a1
Create Date: 2026-08-05 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.db.base import Base


# revision identifiers, used by Alembic.
revision: str = 'b7c1e5a9d3f2'
down_revision: Union[str, Sequence[str], None] = 'f4b8d2e6c9a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Brand-new table (photo gallery per Service Material). Idempotent/checkfirst
    # like the other post-baseline "add a new table" migrations, so it's a no-op
    # on a database provisioned after this model already existed.
    Base.metadata.create_all(bind=op.get_bind(), tables=[
        Base.metadata.tables["erp_service_material_attachments"],
    ])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("erp_service_material_attachments")

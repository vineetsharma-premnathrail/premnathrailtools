"""R&D Settings › Team: which members may create Technical Offers
(heads always can).

Revision ID: c3f7a9d1e5b8
Revises: b8e2f4a6c1d3
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "c3f7a9d1e5b8"
down_revision = "b8e2f4a6c1d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("rnd_team_members")}
    if "can_create_technical_offer" not in cols:
        op.add_column("rnd_team_members", sa.Column("can_create_technical_offer", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("rnd_team_members", "can_create_technical_offer")

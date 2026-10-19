"""R&D Settings: "Can see Technical Offers" (view-only) on the R&D
permission list. R&D heads now come from Organization › Department.

Revision ID: 9e4b2c7a1d38
Revises: c175e66a5e75
"""
from alembic import op
import sqlalchemy as sa

revision = "9e4b2c7a1d38"
down_revision = "c175e66a5e75"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "can_view_technical_offer" not in _columns("rnd_team_members"):
        op.add_column("rnd_team_members", sa.Column("can_view_technical_offer", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    if "can_view_technical_offer" in _columns("rnd_team_members"):
        op.drop_column("rnd_team_members", "can_view_technical_offer")

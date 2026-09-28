"""drop api_keys table (feature removed — no real consumers, zero rows)

Revision ID: c1a2b3d4e5f6
Revises: 9b3d7e1c4a52
Create Date: 2026-09-26

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "c1a2b3d4e5f6"
down_revision = "9b3d7e1c4a52"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("api_keys")


def downgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("key_hash", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("prefix", sa.String(), nullable=False),
        sa.Column("allowed_apps", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

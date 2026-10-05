"""Add store_item_types master (editable Item Type dropdown)

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-10-03

"""
from alembic import op
import sqlalchemy as sa

revision = "f0a1b2c3d4e5"
down_revision = "e9f0a1b2c3d4"
branch_labels = None
depends_on = None

_SEED = [
    ("material", "Material", "MT"), ("service", "Service", "SV"), ("asset", "Asset", "AS"),
    ("consumable", "Consumable", "CN"), ("tool_equipment", "Tool & Equipment", "TE"),
]


def upgrade() -> None:
    table = op.create_table(
        "store_item_types",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("value", sa.String(50), nullable=False, unique=True),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("prefix", sa.String(6), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    op.bulk_insert(table, [{"value": v, "label": l, "prefix": p} for v, l, p in _SEED])


def downgrade() -> None:
    op.drop_table("store_item_types")

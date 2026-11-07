"""Item Master: the item's own name at each unit / plant (owner, 2026-11-07).
Item Name stays the name as on the vendor's invoice; unit_names holds what
Unit 1, Unit 2 ... call it inside the factory - [{"branch_id": 1, "name": "..."}].

Revision ID: e6f1a3c8b2d5
Revises: d4e8a2c6b1f9
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e6f1a3c8b2d5"
down_revision = "d4e8a2c6b1f9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("store_items")}
    if "unit_names" not in cols:
        op.add_column("store_items", sa.Column("unit_names", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("store_items", "unit_names")

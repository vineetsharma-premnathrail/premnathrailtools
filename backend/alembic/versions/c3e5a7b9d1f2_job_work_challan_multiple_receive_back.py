"""Job work challan: several items to receive back.

Material sent on one challan can come back as different items (plate sent,
flange + ring back). store_material_issues.output_items holds every item
expected back as [{item_id, quantity}]; existing challans get their single
output_item_id copied in (quantity not known).
output_item_id stays (the first item) for older readers.

Revision ID: c3e5a7b9d1f2
Revises: b8d0f2a4c6e9
Create Date: 2026-10-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "c3e5a7b9d1f2"
down_revision = "b8d0f2a4c6e9"
branch_labels = None
depends_on = None

TABLE = "store_material_issues"


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}
    if "output_items" not in cols:
        op.add_column(TABLE, sa.Column("output_items", JSONB, nullable=True))
    op.execute(sa.text(f"""
        UPDATE {TABLE} SET output_items = jsonb_build_array(jsonb_build_object('item_id', output_item_id, 'quantity', NULL))
        WHERE output_item_id IS NOT NULL AND output_items IS NULL
    """))


def downgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}
    if "output_items" in cols:
        op.drop_column(TABLE, "output_items")

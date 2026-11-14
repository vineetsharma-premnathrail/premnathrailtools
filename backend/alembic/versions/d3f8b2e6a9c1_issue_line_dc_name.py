"""Material Issue line: "Name on DC" (owner, 2026-11-13) - the item's name as on the vendor's bill,
printed on the delivery challan to the project site; stock and cost stay on the Item Master item.

Revision ID: d3f8b2e6a9c1
Revises: c7e2a9d4b1f8
"""
from alembic import op
import sqlalchemy as sa

revision = "d3f8b2e6a9c1"
down_revision = "c7e2a9d4b1f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("store_material_issue_items")}
    if "dc_name" not in cols:
        op.add_column("store_material_issue_items", sa.Column("dc_name", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("store_material_issue_items", "dc_name")

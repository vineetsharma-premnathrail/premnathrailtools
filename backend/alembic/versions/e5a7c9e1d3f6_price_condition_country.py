"""Country prices: a price record may apply to every customer in one country.

New nullable column product_price_conditions.country (String 50, indexed).
Nothing existing changes (currency was already stored per record).

Revision ID: e5a7c9e1d3f6
Revises: d2f4a6c8e0b1
"""
from alembic import op
import sqlalchemy as sa

revision = "e5a7c9e1d3f6"
down_revision = "d2f4a6c8e0b1"
branch_labels = None
depends_on = None

TABLE = "product_price_conditions"


def upgrade():
    if "country" not in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(TABLE)}:
        op.add_column(TABLE, sa.Column("country", sa.String(50), nullable=True))
        op.create_index("ix_product_price_conditions_country", TABLE, ["country"])


def downgrade():
    op.drop_index("ix_product_price_conditions_country", table_name=TABLE)
    op.drop_column(TABLE, "country")

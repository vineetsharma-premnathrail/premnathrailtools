"""P2P purchase orders made outside the portal (Tally) and uploaded.

Adds p2p_purchase_orders.source + external_ref and a unique index on the pair,
so the same Tally PO can't be uploaded twice. Existing POs keep NULL (made in
the portal).

Revision ID: b7e3c9a1d5f4
Revises: b7d2f4a8c1e5
"""
from alembic import op
import sqlalchemy as sa

revision = "b7e3c9a1d5f4"
down_revision = "b7d2f4a8c1e5"
branch_labels = None
depends_on = None

_TABLE = "p2p_purchase_orders"
_INDEX = "uq_p2p_purchase_orders_source_external_ref"


def upgrade():
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(_TABLE)}
    if "source" not in cols:
        op.add_column(_TABLE, sa.Column("source", sa.String(20), nullable=True))
    if "external_ref" not in cols:
        op.add_column(_TABLE, sa.Column("external_ref", sa.String(100), nullable=True))
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(_TABLE)}
    if _INDEX not in indexes:
        op.create_index(_INDEX, _TABLE, ["source", "external_ref"], unique=True)


def downgrade():
    op.drop_index(_INDEX, table_name=_TABLE)
    op.drop_column(_TABLE, "external_ref")
    op.drop_column(_TABLE, "source")

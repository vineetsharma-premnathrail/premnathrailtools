"""Sales order types remapped to the new list (data-only).

sales_orders.order_type:
  rrv_supply -> road_rail_vehicle, spares -> accessories, service -> other,
  other stays other. Column server default becomes road_rail_vehicle.
  (No CHECK constraint exists on this column; none is added.)

Revision ID: b7d2f4a8c1e5
Revises: a4c9e1d7b2f6
"""
from alembic import op
import sqlalchemy as sa

revision = "b7d2f4a8c1e5"
down_revision = "a4c9e1d7b2f6"
branch_labels = None
depends_on = None

TABLE = "sales_orders"
COL = "order_type"


def _ready() -> bool:
    insp = sa.inspect(op.get_bind())
    if TABLE not in insp.get_table_names():
        return False
    return COL in {c["name"] for c in insp.get_columns(TABLE)}


def _remap(mapping: dict[str, str]) -> None:
    for old, new in mapping.items():
        op.execute(sa.text(f"UPDATE {TABLE} SET {COL} = :new WHERE {COL} = :old").bindparams(new=new, old=old))


def upgrade() -> None:
    if not _ready():
        return
    _remap({"rrv_supply": "road_rail_vehicle", "spares": "accessories", "service": "other"})
    op.alter_column(TABLE, COL, existing_type=sa.String(20), existing_nullable=False,
                    server_default="road_rail_vehicle")


def downgrade() -> None:
    if not _ready():
        return
    # Lossy: former `service` orders are now `other` and cannot be restored;
    # rail_bound_vehicle collapses into rrv_supply.
    _remap({"road_rail_vehicle": "rrv_supply", "rail_bound_vehicle": "rrv_supply", "accessories": "spares"})
    op.alter_column(TABLE, COL, existing_type=sa.String(20), existing_nullable=False,
                    server_default="rrv_supply")

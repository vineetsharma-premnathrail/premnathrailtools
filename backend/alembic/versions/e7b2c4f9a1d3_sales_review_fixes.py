"""sales review fixes: sales_order_schedules.ld_free_until (DP extension
"without LD" grants an LD-free window up to the granted date instead of
waiving LD forever) and a partial unique index so one RRV build can sit on
only one live (non-cancelled) delivery row.

Backfill: rows a "without LD" grant had flagged ld_waived get
ld_free_until = their current (granted) date and ld_waived cleared, so LD
accrues again after that date.

Revision ID: e7b2c4f9a1d3
Revises: d4a7c9e1f3b6
Create Date: 2026-10-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "e7b2c4f9a1d3"
down_revision = "d4a7c9e1f3b6"
branch_labels = None
depends_on = None

_TABLE = "sales_order_schedules"
_INDEX = "uq_sales_schedule_live_build"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _TABLE not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns(_TABLE)}
    if "ld_free_until" not in cols:
        op.add_column(_TABLE, sa.Column("ld_free_until", sa.Date(), nullable=True))
        op.execute(sa.text(
            f"UPDATE {_TABLE} SET ld_free_until = current_delivery_date, ld_waived = :f "
            f"WHERE ld_waived = :t AND current_delivery_date IS NOT NULL"
        ).bindparams(f=False, t=True))

    indexes = {ix["name"] for ix in inspector.get_indexes(_TABLE)}
    if _INDEX not in indexes:
        where = sa.text("rrv_build_id IS NOT NULL AND status <> 'cancelled'")
        if bind.dialect.name == "postgresql":
            op.create_index(_INDEX, _TABLE, ["rrv_build_id"], unique=True, postgresql_where=where)
        elif bind.dialect.name == "sqlite":
            op.create_index(_INDEX, _TABLE, ["rrv_build_id"], unique=True, sqlite_where=where)
        else:  # no partial-index support: the row lock in service.link_build still serialises linking
            pass


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _TABLE not in set(inspector.get_table_names()):
        return
    if _INDEX in {ix["name"] for ix in inspector.get_indexes(_TABLE)}:
        op.drop_index(_INDEX, table_name=_TABLE)
    if "ld_free_until" in {c["name"] for c in inspector.get_columns(_TABLE)}:
        op.execute(sa.text(
            f"UPDATE {_TABLE} SET ld_waived = :t WHERE ld_free_until IS NOT NULL AND ld_free_until >= current_delivery_date"
        ).bindparams(t=True))
        with op.batch_alter_table(_TABLE) as batch:
            batch.drop_column("ld_free_until")

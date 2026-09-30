"""add store reservation link to production work order materials

Releasing a work order now reserves its components in Store (a
store_stock_reservations row per line, production_order = WO number), so
two orders can't both count on the same stock. Each line keeps a pointer to
its reservation.

Revision ID: c5d7e9f1a3b6
Revises: a9691d4d422a
Create Date: 2026-09-30 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c5d7e9f1a3b6'
down_revision = 'a9691d4d422a'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("production_work_order_materials")}
    if "reservation_id" not in columns:
        with op.batch_alter_table("production_work_order_materials") as batch_op:
            batch_op.add_column(sa.Column("reservation_id", sa.Integer(), nullable=True))
            batch_op.create_foreign_key(
                "fk_production_wo_materials_reservation_id", "store_stock_reservations", ["reservation_id"], ["id"],
            )


def downgrade() -> None:
    with op.batch_alter_table("production_work_order_materials") as batch_op:
        batch_op.drop_constraint("fk_production_wo_materials_reservation_id", type_="foreignkey")
        batch_op.drop_column("reservation_id")

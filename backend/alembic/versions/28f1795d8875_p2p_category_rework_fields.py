"""p2p category rework fields

Revision ID: 28f1795d8875
Revises: ae4ebdb39302
Create Date: 2026-09-02 00:00:00.000000

Recreated retroactively: this revision id was already stamped on some
deployed databases (the original file was never committed to git), and its
columns already exist there. It's reconstructed here — checking for
existing columns before adding, same as the rest of this chain — purely so
`alembic history` has no gap and later revisions have somewhere real to
chain from. Not currently used by any SQLAlchemy model or route.
"""
from alembic import op
import sqlalchemy as sa

revision = "28f1795d8875"
down_revision = "ae4ebdb39302"
branch_labels = None
depends_on = None


P2P_REQUEST_COLUMNS = [
    ("purpose_reason", sa.Column("purpose_reason", sa.Text(), nullable=True)),
    ("delivery_location", sa.Column("delivery_location", sa.String(length=255), nullable=True)),
    ("machine_equipment", sa.Column("machine_equipment", sa.String(length=255), nullable=True)),
    ("machine_id", sa.Column("machine_id", sa.String(length=100), nullable=True)),
    ("failure_reason", sa.Column("failure_reason", sa.Text(), nullable=True)),
    ("machine_down", sa.Column("machine_down", sa.Boolean(), nullable=True)),
    ("assigned_to", sa.Column("assigned_to", sa.String(length=150), nullable=True)),
    ("estimated_cost", sa.Column("estimated_cost", sa.Float(), nullable=True)),
    ("scope_of_work", sa.Column("scope_of_work", sa.Text(), nullable=True)),
    ("service_start_date", sa.Column("service_start_date", sa.Date(), nullable=True)),
    ("service_completion_date", sa.Column("service_completion_date", sa.Date(), nullable=True)),
]

P2P_REQUEST_ITEM_COLUMNS = [
    ("item_code", sa.Column("item_code", sa.String(length=100), nullable=True)),
    ("drawing_number", sa.Column("drawing_number", sa.String(length=100), nullable=True)),
    ("bom_reference", sa.Column("bom_reference", sa.String(length=150), nullable=True)),
    ("specification", sa.Column("specification", sa.Text(), nullable=True)),
    ("estimated_unit_price", sa.Column("estimated_unit_price", sa.Float(), nullable=True)),
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    request_columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
    with op.batch_alter_table("p2p_requests") as batch_op:
        for name, column in P2P_REQUEST_COLUMNS:
            if name not in request_columns:
                batch_op.add_column(column)

    item_columns = {c["name"] for c in inspector.get_columns("p2p_request_items")}
    with op.batch_alter_table("p2p_request_items") as batch_op:
        for name, column in P2P_REQUEST_ITEM_COLUMNS:
            if name not in item_columns:
                batch_op.add_column(column)


def downgrade() -> None:
    with op.batch_alter_table("p2p_request_items") as batch_op:
        for name, _ in P2P_REQUEST_ITEM_COLUMNS:
            batch_op.drop_column(name)
    with op.batch_alter_table("p2p_requests") as batch_op:
        for name, _ in P2P_REQUEST_COLUMNS:
            batch_op.drop_column(name)

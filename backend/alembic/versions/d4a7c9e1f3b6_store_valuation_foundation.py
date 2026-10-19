"""store valuation foundation (Phase A): store_item_valuations,
store_valuation_events, cost columns on store_stock_transactions,
store_items.lead_time_days and store_items.legacy_code

Phase A of docs/02-modules/store/foundation-plan.md. Additive and nullable
only — no existing column is altered (moving_average_cost stays Float). The
valuation engine stays off until the Store setting `valuation_enabled` is
switched on by the Phase D cut-over.

Revision ID: d4a7c9e1f3b6
Revises: c5e8a2d4f7b1
Create Date: 2026-10-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "d4a7c9e1f3b6"
down_revision = "c5e8a2d4f7b1"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)
QTY = sa.Numeric(18, 4)
RATE = sa.Numeric(18, 4)

_TXN_COLUMNS = [
    ("unit_cost", RATE),
    ("value", MONEY),
    ("cost_source", sa.String(length=20)),
    ("valuation_qty_after", QTY),
    ("valuation_value_after", MONEY),
]


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    ]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "store_item_valuations" not in tables:
        op.create_table(
            "store_item_valuations",
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), primary_key=True),
            sa.Column("qty", QTY, nullable=False, server_default="0"),
            sa.Column("value", MONEY, nullable=False, server_default="0"),
            sa.Column("avg_rate", RATE, nullable=True),
            sa.Column("last_receipt_rate", RATE, nullable=True),
            sa.Column("last_receipt_date", sa.Date(), nullable=True),
            sa.Column("last_receipt_ref", sa.String(length=100), nullable=True),
            sa.Column("unvalued_qty", QTY, nullable=False, server_default="0"),
            *_timestamps(),
        )

    if "store_valuation_events" not in tables:
        op.create_table(
            "store_valuation_events",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=False),
            sa.Column("event_type", sa.String(length=30), nullable=False),
            sa.Column("value_delta", MONEY, nullable=False, server_default="0"),
            sa.Column("qty_basis", QTY, nullable=True),
            sa.Column("rate_before", RATE, nullable=True),
            sa.Column("rate_after", RATE, nullable=True),
            sa.Column("reference_type", sa.String(length=30), nullable=True),
            sa.Column("reference_number", sa.String(length=100), nullable=True),
            sa.Column("reason", sa.Text(), nullable=False),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("event_date", sa.Date(), nullable=False),
            *_timestamps(),
        )
        op.create_index("ix_store_valuation_events_item_id", "store_valuation_events", ["item_id"])

    txn_cols = {c["name"] for c in inspector.get_columns("store_stock_transactions")}
    missing = [(n, t) for n, t in _TXN_COLUMNS if n not in txn_cols]
    if missing:
        with op.batch_alter_table("store_stock_transactions") as batch:
            for name, type_ in missing:
                batch.add_column(sa.Column(name, type_, nullable=True))

    item_cols = {c["name"] for c in inspector.get_columns("store_items")}
    with op.batch_alter_table("store_items") as batch:
        if "lead_time_days" not in item_cols:
            batch.add_column(sa.Column("lead_time_days", sa.Integer(), nullable=True))
        if "legacy_code" not in item_cols:
            batch.add_column(sa.Column("legacy_code", sa.String(length=50), nullable=True))
    item_indexes = {i["name"] for i in inspector.get_indexes("store_items")}
    if "ix_store_items_legacy_code" not in item_indexes:
        # Unique when set: NULLs don't collide in a unique index.
        op.create_index("ix_store_items_legacy_code", "store_items", ["legacy_code"], unique=True)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    item_indexes = {i["name"] for i in inspector.get_indexes("store_items")}
    if "ix_store_items_legacy_code" in item_indexes:
        op.drop_index("ix_store_items_legacy_code", table_name="store_items")
    item_cols = {c["name"] for c in inspector.get_columns("store_items")}
    with op.batch_alter_table("store_items") as batch:
        if "legacy_code" in item_cols:
            batch.drop_column("legacy_code")
        if "lead_time_days" in item_cols:
            batch.drop_column("lead_time_days")

    txn_cols = {c["name"] for c in inspector.get_columns("store_stock_transactions")}
    present = [n for n, _ in reversed(_TXN_COLUMNS) if n in txn_cols]
    if present:
        with op.batch_alter_table("store_stock_transactions") as batch:
            for name in present:
                batch.drop_column(name)

    if "store_valuation_events" in tables:
        op.drop_index("ix_store_valuation_events_item_id", table_name="store_valuation_events")
        op.drop_table("store_valuation_events")
    if "store_item_valuations" in tables:
        op.drop_table("store_item_valuations")

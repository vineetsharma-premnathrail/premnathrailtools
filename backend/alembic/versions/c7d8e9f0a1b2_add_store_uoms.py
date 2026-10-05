"""Add store_uoms master (user-editable UOM dropdown)

Revision ID: c7d8e9f0a1b2
Revises: a96b01f8d752
Create Date: 2026-10-03

"""
from alembic import op
import sqlalchemy as sa

revision = "c7d8e9f0a1b2"
down_revision = "a96b01f8d752"
branch_labels = None
depends_on = None

# Snapshot of STORE_UOMS at the time of this migration.
_SEED = {
    "NOS": "Numbers", "PCS": "Pieces", "SET": "Set", "PAIR": "Pair", "KIT": "Kit", "LOT": "Lot",
    "KG": "Kilogram", "GM": "Gram", "TON": "Tonne",
    "MTR": "Metre", "MM": "Millimetre", "CM": "Centimetre", "FT": "Foot", "INCH": "Inch",
    "SQM": "Square metre", "SQFT": "Square foot", "CUM": "Cubic metre",
    "LTR": "Litre", "ML": "Millilitre",
    "BOX": "Box", "PKT": "Packet", "ROLL": "Roll", "BAG": "Bag", "DRUM": "Drum", "CAN": "Can",
    "BTL": "Bottle", "SHEET": "Sheet", "COIL": "Coil", "BUNDLE": "Bundle",
    "HR": "Hour", "DAY": "Day", "JOB": "Job",
}


def upgrade() -> None:
    table = op.create_table(
        "store_uoms",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(20), nullable=False, unique=True),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    op.bulk_insert(table, [{"code": c, "label": l} for c, l in _SEED.items()])
    # Units already on items but not in the list (typed in as free text).
    op.execute(
        "INSERT INTO store_uoms (code, label) "
        "SELECT DISTINCT UPPER(TRIM(uom)), '' FROM store_items "
        "WHERE uom IS NOT NULL AND TRIM(uom) <> '' AND LENGTH(TRIM(uom)) <= 20 "
        "AND UPPER(TRIM(uom)) NOT IN (SELECT code FROM store_uoms)"
    )


def downgrade() -> None:
    op.drop_table("store_uoms")

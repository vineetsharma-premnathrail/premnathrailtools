"""Item types -> Material/Service/Asset/Consumable/Tool & Equipment; categories per type

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-10-03

"""
from alembic import op
import sqlalchemy as sa

revision = "d8e9f0a1b2c3"
down_revision = "c7d8e9f0a1b2"
branch_labels = None
depends_on = None

# Snapshot of STORE_TYPE_CATEGORIES at the time of this migration.
_SEED = {
    "material": [("Raw Material", "RAW"), ("Production Material", "PRD"), ("Electrical", "ELE"),
                 ("Hydraulic & Pneumatic", "HYD"), ("Mechanical Components", "MEC"),
                 ("Hardware & Fasteners", "HWF"), ("Paint & Chemicals", "PNT"), ("Packaging", "PKG")],
    "service": [("Job Work", "JOB"), ("Maintenance Service", "MSV"), ("Professional Service", "PSV"),
                ("Consultancy", "CON"), ("Other Service", "OSV")],
    "asset": [("Machinery", "MCH"), ("Equipment", "EQP"), ("Vehicle", "VEH"), ("IT Asset", "ITA"),
              ("Furniture", "FUR")],
    "consumable": [("Office Consumables", "OFC"), ("Cleaning", "CLN"), ("PPE", "PPE"),
                   ("Workshop Consumables", "WSC"), ("Production Consumables", "PRC")],
    "tool_equipment": [("Hand Tools", "HTL"), ("Power Tools", "PTL"), ("Measuring Instruments", "MIN"),
                       ("Testing Equipment", "TEQ"), ("Engineering Tools", "ENG")],
}
# Old type -> new type. Item codes already issued keep their old prefix.
_TYPE_MAP = {
    "raw_material": "material", "spare_part": "material", "finished_good": "material",
    "semi_finished": "material", "other": "material",
}


def upgrade() -> None:
    op.add_column("store_item_categories", sa.Column("item_type", sa.String(50), nullable=True))
    conn = op.get_bind()
    for old, new in _TYPE_MAP.items():
        conn.execute(sa.text("UPDATE store_items SET item_type = :new WHERE item_type = :old"), {"new": new, "old": old})

    for item_type, cats in _SEED.items():
        for name, code in cats:
            existing = conn.execute(sa.text(
                "SELECT id FROM store_item_categories WHERE LOWER(name) = LOWER(:n) AND parent_id IS NULL"
            ), {"n": name}).scalar()
            if existing:
                conn.execute(sa.text("UPDATE store_item_categories SET item_type = :t WHERE id = :id"), {"t": item_type, "id": existing})
                continue
            final, n = code, 2
            while conn.execute(sa.text("SELECT 1 FROM store_item_categories WHERE code = :c"), {"c": final}).first():
                final, n = f"{code}{n}", n + 1
            conn.execute(sa.text(
                "INSERT INTO store_item_categories (name, code, item_type, is_active, created_at, updated_at) "
                "VALUES (:n, :c, :t, :a, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ), {"n": name, "c": final, "t": item_type, "a": True})


def downgrade() -> None:
    op.drop_column("store_item_categories", "item_type")

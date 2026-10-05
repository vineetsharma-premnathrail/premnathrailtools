"""Move items off the old store categories onto the standard per-type ones

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-10-03

"""
from alembic import op
import sqlalchemy as sa

revision = "e9f0a1b2c3d4"
down_revision = "d8e9f0a1b2c3"
branch_labels = None
depends_on = None

# Old category name -> (item type, standard category name). Item codes
# already issued are kept; only type/category on the item change.
_MAP = {
    "Hydraulics": ("material", "Hydraulic & Pneumatic"),
    "Pneumatics": ("material", "Hydraulic & Pneumatic"),
    "Hoses & Fittings": ("material", "Hydraulic & Pneumatic"),
    "Electronics & Controls": ("material", "Electrical"),
    "Cables & Wires": ("material", "Electrical"),
    "Mechanical Parts": ("material", "Mechanical Components"),
    "Bearings": ("material", "Mechanical Components"),
    "Seals & Gaskets": ("material", "Mechanical Components"),
    "Brake Components": ("material", "Mechanical Components"),
    "Wheels, Axles & Bogies": ("material", "Mechanical Components"),
    "Engine & Powertrain": ("material", "Mechanical Components"),
    "Fasteners": ("material", "Hardware & Fasteners"),
    "Steel & Metals": ("material", "Raw Material"),
    "Castings & Forgings": ("material", "Raw Material"),
    "Rubber & Plastics": ("material", "Raw Material"),
    "Paints & Coatings": ("material", "Paint & Chemicals"),
    "Lubricants & Oils": ("material", "Paint & Chemicals"),
    "Packing Materials": ("material", "Packaging"),
    "Tools & Tackles": ("tool_equipment", "Hand Tools"),
    "Safety & PPE": ("consumable", "PPE"),
    "General & Office": ("consumable", "Office Consumables"),
}


def upgrade() -> None:
    conn = op.get_bind()

    def std_id(item_type, name):
        return conn.execute(sa.text(
            "SELECT id FROM store_item_categories WHERE parent_id IS NULL AND item_type = :t AND name = :n"
        ), {"t": item_type, "n": name}).scalar()

    for old_name, (item_type, new_name) in _MAP.items():
        old_id = conn.execute(sa.text(
            "SELECT id FROM store_item_categories WHERE parent_id IS NULL AND item_type IS NULL AND name = :n"
        ), {"n": old_name}).scalar()
        new_id = std_id(item_type, new_name)
        if not new_id:
            continue
        conn.execute(sa.text(
            "UPDATE store_items SET item_type = :t, category = :new WHERE category = :old"
        ), {"t": item_type, "new": new_name, "old": old_name})
        if old_id:
            # Subcategories move under the standard category (skip name clashes).
            for sub_id, sub_name in conn.execute(sa.text(
                "SELECT id, name FROM store_item_categories WHERE parent_id = :p"
            ), {"p": old_id}).fetchall():
                clash = conn.execute(sa.text(
                    "SELECT 1 FROM store_item_categories WHERE parent_id = :p AND LOWER(name) = LOWER(:n)"
                ), {"p": new_id, "n": sub_name}).first()
                if clash:
                    conn.execute(sa.text("DELETE FROM store_item_categories WHERE id = :id"), {"id": sub_id})
                else:
                    conn.execute(sa.text(
                        "UPDATE store_item_categories SET parent_id = :p, item_type = :t WHERE id = :id"
                    ), {"p": new_id, "t": item_type, "id": sub_id})
            conn.execute(sa.text("DELETE FROM store_item_categories WHERE id = :id"), {"id": old_id})

    # Seeded categories that got a suffixed code (ENG2...) because an old
    # category held the code: take the plain code back now that it's free.
    for cat_id, code in conn.execute(sa.text(
        "SELECT id, code FROM store_item_categories WHERE item_type IS NOT NULL AND parent_id IS NULL AND code ~ '[A-Z]2$'"
    ) if conn.dialect.name == "postgresql" else sa.text("SELECT id, code FROM store_item_categories WHERE 1=0")).fetchall():
        base = code[:-1]
        if not conn.execute(sa.text("SELECT 1 FROM store_item_categories WHERE code = :c"), {"c": base}).first():
            conn.execute(sa.text("UPDATE store_item_categories SET code = :c WHERE id = :id"), {"c": base, "id": cat_id})


def downgrade() -> None:
    pass

"""seed common Store item categories (codes feed auto item codes)

Adds a starter set of top-level item categories for a rail / heavy-equipment
plant. Each category's `code` becomes the middle part of auto-generated
item codes (<TYPE>-<CODE>-<NNNN>, e.g. RM-HYD-0001 — see
app/modules/store/service.py generate_item_code). Rows whose code OR name
already exists are skipped, so it's safe on a database that already has its
own categories. Downgrade removes only the seeded rows that no item uses.

Revision ID: e2a4c6e8f0b1
Revises: b5d7f9a1c3e6
Create Date: 2026-09-30 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e2a4c6e8f0b1'
down_revision = 'b5d7f9a1c3e6'
branch_labels = None
depends_on = None

COMMON_CATEGORIES = (
    ("HYD", "Hydraulics"),
    ("PNE", "Pneumatics"),
    ("ELE", "Electrical"),
    ("ELX", "Electronics & Controls"),
    ("CBL", "Cables & Wires"),
    ("MEC", "Mechanical Parts"),
    ("FST", "Fasteners"),
    ("BRG", "Bearings"),
    ("SEL", "Seals & Gaskets"),
    ("HOS", "Hoses & Fittings"),
    ("BRK", "Brake Components"),
    ("WHL", "Wheels, Axles & Bogies"),
    ("ENG", "Engine & Powertrain"),
    ("STL", "Steel & Metals"),
    ("CST", "Castings & Forgings"),
    ("RUB", "Rubber & Plastics"),
    ("PNT", "Paints & Coatings"),
    ("LUB", "Lubricants & Oils"),
    ("TLS", "Tools & Tackles"),
    ("PPE", "Safety & PPE"),
    ("PKG", "Packing Materials"),
    ("GEN", "General & Office"),
)


def upgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("store_item_categories"):
        return
    existing = bind.execute(sa.text("SELECT upper(code), lower(name) FROM store_item_categories")).all()
    codes = {c for c, _ in existing}
    names = {n for _, n in existing}
    for code, name in COMMON_CATEGORIES:
        if code in codes or name.lower() in names:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO store_item_categories (name, code, parent_id, is_active, created_at, updated_at) "
                "VALUES (:name, :code, NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"name": name, "code": code},
        )


def downgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("store_item_categories"):
        return
    for code, name in COMMON_CATEGORIES:
        bind.execute(
            sa.text(
                "DELETE FROM store_item_categories c WHERE c.code = :code AND c.name = :name AND c.parent_id IS NULL "
                "AND NOT EXISTS (SELECT 1 FROM store_items i WHERE i.category = c.name) "
                "AND NOT EXISTS (SELECT 1 FROM store_item_categories s WHERE s.parent_id = c.id)"
            ),
            {"code": code, "name": name},
        )

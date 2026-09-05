"""unify manufacturing materials into shared item master

Revision ID: b7c3f9a1d2e4
Revises: ae4ebdb39302
Create Date: 2026-09-03 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "b7c3f9a1d2e4"
down_revision = "28f1795d8875"
branch_labels = None
depends_on = None


def _fk_name(inspector, table: str, column: str) -> str | None:
    for fk in inspector.get_foreign_keys(table):
        if column in fk["constrained_columns"]:
            return fk["name"]
    return None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    bom_columns = {c["name"] for c in inspector.get_columns("manufacturing_boms")}
    bom_item_columns = {c["name"] for c in inspector.get_columns("manufacturing_bom_items")}
    entry_columns = {c["name"] for c in inspector.get_columns("manufacturing_stock_entries")}

    if "output_item_id" not in bom_columns:
        op.add_column("manufacturing_boms", sa.Column("output_item_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_manufacturing_boms_output_item_id_items", "manufacturing_boms", "items", ["output_item_id"], ["id"],
        )
    if "item_id" not in bom_item_columns:
        op.add_column("manufacturing_bom_items", sa.Column("item_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_manufacturing_bom_items_item_id_items", "manufacturing_bom_items", "items", ["item_id"], ["id"],
        )
    if "item_id" not in entry_columns:
        op.add_column("manufacturing_stock_entries", sa.Column("item_id", sa.Integer(), nullable=True))
        op.create_foreign_key(
            "fk_manufacturing_stock_entries_item_id_items", "manufacturing_stock_entries", "items", ["item_id"], ["id"],
        )

    # Migrate every distinct manufacturing_materials row into the shared
    # items table, then repoint the three tables' new *_item_id columns at
    # the newly-created item ids via the old material id.
    materials = bind.execute(sa.text(
        "SELECT id, code, name, unit, category, is_active FROM manufacturing_materials"
    )).fetchall()
    material_to_item: dict[int, int] = {}
    for m in materials:
        result = bind.execute(
            sa.text(
                "INSERT INTO items (item_code, item_name, unit_of_measure, item_group, item_status, "
                "quality_inspection_required, created_at, updated_at) "
                "VALUES (:code, :name, :unit, :category, :status, false, now(), now()) "
                "RETURNING id"
            ),
            {
                "code": m.code,
                "name": m.name,
                "unit": m.unit,
                "category": m.category,
                "status": "Active" if m.is_active else "Inactive",
            },
        )
        material_to_item[m.id] = result.scalar_one()

    for material_id, item_id in material_to_item.items():
        bind.execute(
            sa.text("UPDATE manufacturing_boms SET output_item_id = :item_id WHERE output_material_id = :material_id"),
            {"item_id": item_id, "material_id": material_id},
        )
        bind.execute(
            sa.text("UPDATE manufacturing_bom_items SET item_id = :item_id WHERE material_id = :material_id"),
            {"item_id": item_id, "material_id": material_id},
        )
        bind.execute(
            sa.text("UPDATE manufacturing_stock_entries SET item_id = :item_id WHERE material_id = :material_id"),
            {"item_id": item_id, "material_id": material_id},
        )

    inspector = sa.inspect(bind)
    for table, old_col in (
        ("manufacturing_boms", "output_material_id"),
        ("manufacturing_bom_items", "material_id"),
        ("manufacturing_stock_entries", "material_id"),
    ):
        new_col = "output_item_id" if table == "manufacturing_boms" else "item_id"
        with op.batch_alter_table(table) as batch_op:
            batch_op.alter_column(new_col, nullable=False)
            fk_name = _fk_name(inspector, table, old_col)
            if fk_name:
                batch_op.drop_constraint(fk_name, type_="foreignkey")
            batch_op.drop_column(old_col)

    op.drop_index("ix_manufacturing_materials_code", table_name="manufacturing_materials")
    op.drop_table("manufacturing_materials")


def downgrade() -> None:
    op.create_table(
        "manufacturing_materials",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("category", sa.String(length=100), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_manufacturing_materials_code", "manufacturing_materials", ["code"], unique=True)

    bind = op.get_bind()
    op.add_column("manufacturing_boms", sa.Column("output_material_id", sa.Integer(), nullable=True))
    op.add_column("manufacturing_bom_items", sa.Column("material_id", sa.Integer(), nullable=True))
    op.add_column("manufacturing_stock_entries", sa.Column("material_id", sa.Integer(), nullable=True))

    # Best-effort data restore: recreate one manufacturing_materials row per
    # item still referenced by these tables. Items created outside this
    # migration (e.g. via Purchase/Store since the upgrade ran) are not
    # rolled back into manufacturing_materials — full downgrade fidelity
    # isn't guaranteed once the shared item master has diverged.
    referenced_item_ids = {
        row[0]
        for row in bind.execute(sa.text(
            "SELECT output_item_id FROM manufacturing_boms "
            "UNION SELECT item_id FROM manufacturing_bom_items "
            "UNION SELECT item_id FROM manufacturing_stock_entries"
        )).fetchall()
        if row[0] is not None
    }
    item_to_material: dict[int, int] = {}
    if referenced_item_ids:
        items = bind.execute(
            sa.text(
                "SELECT id, item_code, item_name, unit_of_measure, item_group, item_status "
                "FROM items WHERE id IN :ids"
            ).bindparams(sa.bindparam("ids", expanding=True)),
            {"ids": list(referenced_item_ids)},
        ).fetchall()
        for i in items:
            result = bind.execute(
                sa.text(
                    "INSERT INTO manufacturing_materials (code, name, unit, category, is_active, created_at, updated_at) "
                    "VALUES (:code, :name, :unit, :category, :is_active, now(), now()) RETURNING id"
                ),
                {
                    "code": i.item_code,
                    "name": i.item_name,
                    "unit": i.unit_of_measure,
                    "category": i.item_group,
                    "is_active": i.item_status == "Active",
                },
            )
            item_to_material[i.id] = result.scalar_one()

    for item_id, material_id in item_to_material.items():
        bind.execute(
            sa.text("UPDATE manufacturing_boms SET output_material_id = :material_id WHERE output_item_id = :item_id"),
            {"material_id": material_id, "item_id": item_id},
        )
        bind.execute(
            sa.text("UPDATE manufacturing_bom_items SET material_id = :material_id WHERE item_id = :item_id"),
            {"material_id": material_id, "item_id": item_id},
        )
        bind.execute(
            sa.text("UPDATE manufacturing_stock_entries SET material_id = :material_id WHERE item_id = :item_id"),
            {"material_id": material_id, "item_id": item_id},
        )

    with op.batch_alter_table("manufacturing_boms") as batch_op:
        batch_op.alter_column("output_material_id", nullable=False)
        batch_op.drop_constraint("fk_manufacturing_boms_output_item_id_items", type_="foreignkey")
        batch_op.drop_column("output_item_id")
    with op.batch_alter_table("manufacturing_bom_items") as batch_op:
        batch_op.alter_column("material_id", nullable=False)
        batch_op.drop_constraint("fk_manufacturing_bom_items_item_id_items", type_="foreignkey")
        batch_op.drop_column("item_id")
    with op.batch_alter_table("manufacturing_stock_entries") as batch_op:
        batch_op.alter_column("material_id", nullable=False)
        batch_op.drop_constraint("fk_manufacturing_stock_entries_item_id_items", type_="foreignkey")
        batch_op.drop_column("item_id")

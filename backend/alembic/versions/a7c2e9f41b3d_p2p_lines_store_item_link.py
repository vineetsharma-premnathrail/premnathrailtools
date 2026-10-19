"""P2P: PR / PO / GRN lines carry the Item Master id (store_item_id).

Standard practice — a purchase line is identified by the material, not by a
typed name. New lines get the id from the item picked in the PR form; this
migration links the existing lines once:
  1. Item Code — part_code equal to a store item's item_code (the Store,
     Maintenance and Production "Raise PR" shortcuts put the code there);
  2. otherwise the exact item name, but only when exactly ONE store item has
     that name (an ambiguous name is left unlinked, never guessed);
  3. GRN lines take their PO line's id.
Lines still unlinked are older records; their PO line is linked by hand
("Link to Item Master" on the PO) before goods can be received.

Revision ID: a7c2e9f41b3d
Revises: f6a1d4b8c3e2
Create Date: 2026-10-11
"""
from alembic import op
import sqlalchemy as sa

revision = "a7c2e9f41b3d"
down_revision = "f6a1d4b8c3e2"
branch_labels = None
depends_on = None

TABLES = ("p2p_request_items", "p2p_purchase_order_items", "p2p_goods_receipt_items")


def _norm(v) -> str:
    return " ".join(str(v or "").split()).lower()


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for table in TABLES:
        if "store_item_id" not in {c["name"] for c in insp.get_columns(table)}:
            with op.batch_alter_table(table) as batch:
                batch.add_column(sa.Column("store_item_id", sa.Integer(), nullable=True))
                batch.create_foreign_key(f"fk_{table}_store_item_id", "store_items", ["store_item_id"], ["id"])
                batch.create_index(f"ix_{table}_store_item_id", ["store_item_id"])

    # One-time link of existing lines (see module docstring).
    by_code: dict[str, int] = {}
    by_name: dict[str, list[int]] = {}
    for sid, code, name in bind.execute(sa.text("SELECT id, item_code, item_name FROM store_items")):
        if code:
            by_code[_norm(code)] = sid
        by_name.setdefault(_norm(name), []).append(sid)

    def resolve(part_code, item_name) -> int | None:
        if part_code and _norm(part_code) in by_code:
            return by_code[_norm(part_code)]
        ids = by_name.get(_norm(item_name), [])
        return ids[0] if len(ids) == 1 else None

    for table in ("p2p_request_items", "p2p_purchase_order_items"):
        rows = bind.execute(sa.text(f"SELECT id, part_code, item_name FROM {table} WHERE store_item_id IS NULL")).fetchall()
        for row_id, part_code, item_name in rows:
            sid = resolve(part_code, item_name)
            if sid:
                bind.execute(sa.text(f"UPDATE {table} SET store_item_id = :sid WHERE id = :id"), {"sid": sid, "id": row_id})

    bind.execute(sa.text(
        "UPDATE p2p_goods_receipt_items SET store_item_id = "
        "(SELECT po.store_item_id FROM p2p_purchase_order_items po WHERE po.id = p2p_goods_receipt_items.po_item_id) "
        "WHERE store_item_id IS NULL"
    ))


def downgrade() -> None:
    for table in reversed(TABLES):
        with op.batch_alter_table(table) as batch:
            batch.drop_index(f"ix_{table}_store_item_id")
            batch.drop_constraint(f"fk_{table}_store_item_id", type_="foreignkey")
            batch.drop_column("store_item_id")

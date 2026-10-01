"""Give every branch a default warehouse

Revision ID: a96b01f8d752
Revises: a2b3c4d5e6f7
Create Date: 2026-10-01

"""
from alembic import op
import sqlalchemy as sa

revision = "a96b01f8d752"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Mirrors ensure_branch_warehouse() in organization/routes/branch.py.
    conn = op.get_bind()
    branches = conn.execute(sa.text(
        "SELECT id, name, code, manager_user_id FROM branches WHERE default_warehouse_id IS NULL ORDER BY id"
    )).fetchall()
    for b in branches:
        wh_id = conn.execute(sa.text(
            "SELECT id FROM store_locations WHERE branch_id = :bid ORDER BY id LIMIT 1"
        ), {"bid": b.id}).scalar()
        if wh_id is None:
            base = f"WH-{b.code}"[:30]
            code, n = base, 2
            while conn.execute(sa.text("SELECT 1 FROM store_locations WHERE code = :c"), {"c": code}).first():
                suffix = f"-{n}"
                code, n = base[:30 - len(suffix)] + suffix, n + 1
            wh_id = conn.execute(sa.text(
                "INSERT INTO store_locations (branch_id, name, code, manager_user_id, status, is_active, created_at, updated_at) "
                "VALUES (:bid, :name, :code, :mgr, 'active', true, now(), now()) RETURNING id"
            ), {"bid": b.id, "name": f"{b.name} Warehouse"[:150], "code": code, "mgr": b.manager_user_id}).scalar()
        conn.execute(sa.text("UPDATE branches SET default_warehouse_id = :wid WHERE id = :bid"), {"wid": wh_id, "bid": b.id})


def downgrade() -> None:
    # Data backfill — warehouses may already hold stock, so nothing is removed.
    pass

"""Vendor 'Referred by' (employee / external / direct) + creator backfill.

created_by_id already exists on vendors (auto-set on create); rows with no
creator get it from the vendor's own 'created' audit entry when one exists
(exact match on entity + id, earliest entry) — otherwise left NULL.

Revision ID: e5a1c8d3f7b2
Revises: d2f7b9c4e8a1
"""
from alembic import op
import sqlalchemy as sa

revision = "e5a1c8d3f7b2"
down_revision = "d2f7b9c4e8a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    cols = {c["name"] for c in inspector.get_columns("vendors")}
    with op.batch_alter_table("vendors") as batch:
        if "referral_type" not in cols:
            batch.add_column(sa.Column("referral_type", sa.String(length=10), nullable=True))
        if "referred_by_user_id" not in cols:
            batch.add_column(sa.Column("referred_by_user_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_vendors_referred_by_user_id", "users", ["referred_by_user_id"], ["id"], ondelete="SET NULL")
        if "referred_by_name" not in cols:
            batch.add_column(sa.Column("referred_by_name", sa.String(length=150), nullable=True))
        if "referred_by_phone" not in cols:
            batch.add_column(sa.Column("referred_by_phone", sa.String(length=30), nullable=True))
    if "audit_logs" in inspector.get_table_names():
        op.execute(sa.text(
            "UPDATE vendors SET created_by_id = (SELECT a.performed_by_id FROM audit_logs a "
            "WHERE a.entity_type = 'vendor' AND a.action = 'created' AND a.entity_id = vendors.id "
            "AND a.performed_by_id IN (SELECT id FROM users) ORDER BY a.id ASC LIMIT 1) "
            "WHERE created_by_id IS NULL"))


def downgrade() -> None:
    with op.batch_alter_table("vendors") as batch:
        batch.drop_constraint("fk_vendors_referred_by_user_id", type_="foreignkey")
        batch.drop_column("referred_by_phone")
        batch.drop_column("referred_by_name")
        batch.drop_column("referred_by_user_id")
        batch.drop_column("referral_type")

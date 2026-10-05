"""Material issue vendor name

Revision ID: a2b3c4d5e6f8
Revises: f1a2b3c4d5e7
Create Date: 2026-10-05

"""
from alembic import op
import sqlalchemy as sa

revision = "a2b3c4d5e6f8"
down_revision = "f1a2b3c4d5e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("store_material_issues")}
    if "vendor_name" not in columns:
        with op.batch_alter_table("store_material_issues") as batch:
            batch.add_column(sa.Column("vendor_name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("store_material_issues") as batch:
        batch.drop_column("vendor_name")

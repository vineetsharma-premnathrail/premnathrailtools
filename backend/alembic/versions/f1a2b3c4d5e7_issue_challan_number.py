"""Material issue challan number

Revision ID: f1a2b3c4d5e7
Revises: e5f6a7b8c9d1
Create Date: 2026-10-05

"""
from alembic import op
import sqlalchemy as sa

revision = "f1a2b3c4d5e7"
down_revision = "e5f6a7b8c9d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("store_material_issues")}
    if "challan_number" not in columns:
        with op.batch_alter_table("store_material_issues") as batch:
            batch.add_column(sa.Column("challan_number", sa.String(length=50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("store_material_issues") as batch:
        batch.drop_column("challan_number")

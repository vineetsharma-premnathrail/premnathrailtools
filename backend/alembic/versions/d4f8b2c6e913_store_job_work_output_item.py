"""Store job work: the processed item expected back on a job-work challan
(store_material_issues.output_item_id), so the Job Work Receipt starts from it.

Revision ID: d4f8b2c6e913
Revises: c6d2e8a4f190
"""
from alembic import op
import sqlalchemy as sa

revision = "d4f8b2c6e913"
down_revision = "c6d2e8a4f190"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("store_material_issues")}
    if "output_item_id" not in cols:
        with op.batch_alter_table("store_material_issues") as batch:
            batch.add_column(sa.Column("output_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("store_material_issues") as batch:
        batch.drop_column("output_item_id")

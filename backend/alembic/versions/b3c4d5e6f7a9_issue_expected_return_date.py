"""Material issue expected return date

Revision ID: b3c4d5e6f7a9
Revises: a2b3c4d5e6f8
Create Date: 2026-10-05

"""
from alembic import op
import sqlalchemy as sa

revision = "b3c4d5e6f7a9"
down_revision = "a2b3c4d5e6f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("store_material_issues")}
    if "expected_return_date" not in columns:
        with op.batch_alter_table("store_material_issues") as batch:
            batch.add_column(sa.Column("expected_return_date", sa.Date(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("store_material_issues") as batch:
        batch.drop_column("expected_return_date")

"""simplify asset register form: add item_code/asset_type/location_text, relax required columns on assets

Revision ID: b1d4f7a9e2c5
Revises: a9c2e5f8d1b3
Create Date: 2026-09-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "b1d4f7a9e2c5"
down_revision = "a9c2e5f8d1b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("assets")}

    if "item_code" not in columns:
        op.add_column("assets", sa.Column("item_code", sa.String(length=100), nullable=True))
    if "asset_type" not in columns:
        op.add_column("assets", sa.Column("asset_type", sa.String(length=100), nullable=True))
    if "location_text" not in columns:
        op.add_column("assets", sa.Column("location_text", sa.String(length=255), nullable=True))

    with op.batch_alter_table("assets") as batch_op:
        batch_op.alter_column("category_id", existing_type=sa.Integer(), nullable=True)
        batch_op.alter_column("acquisition_date", existing_type=sa.Date(), nullable=True)
        batch_op.alter_column("purchase_cost", existing_type=sa.Float(), nullable=True)
        batch_op.alter_column("source", existing_type=sa.String(length=20), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("assets") as batch_op:
        batch_op.alter_column("source", existing_type=sa.String(length=20), nullable=False)
        batch_op.alter_column("purchase_cost", existing_type=sa.Float(), nullable=False)
        batch_op.alter_column("acquisition_date", existing_type=sa.Date(), nullable=False)
        batch_op.alter_column("category_id", existing_type=sa.Integer(), nullable=False)

    op.drop_column("assets", "location_text")
    op.drop_column("assets", "asset_type")
    op.drop_column("assets", "item_code")

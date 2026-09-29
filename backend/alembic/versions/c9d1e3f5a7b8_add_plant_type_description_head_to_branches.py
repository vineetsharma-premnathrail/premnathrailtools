"""add plant_type, description, head_user_id to branches

Revision ID: c9d1e3f5a7b8
Revises: a4c8f1d3b7e2
Create Date: 2026-09-29 00:00:00.000000

The Branch model has carried these three fields since the plant-fields
expansion, and routes/branch.py reads branch.head_user_id directly, but no
migration ever added them to the branches table — they were only ever
present on databases where someone patched the schema by hand.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c9d1e3f5a7b8'
down_revision = 'a4c8f1d3b7e2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("branches")}
    if "plant_type" not in columns:
        op.add_column("branches", sa.Column("plant_type", sa.String(length=100), nullable=True))
    if "description" not in columns:
        op.add_column("branches", sa.Column("description", sa.Text(), nullable=True))
    if "head_user_id" not in columns:
        op.add_column("branches", sa.Column("head_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("branches", "head_user_id")
    op.drop_column("branches", "description")
    op.drop_column("branches", "plant_type")

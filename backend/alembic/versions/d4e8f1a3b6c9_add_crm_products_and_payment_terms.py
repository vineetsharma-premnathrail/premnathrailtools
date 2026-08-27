"""add crm_products and crm_payment_terms tables

Revision ID: d4e8f1a3b6c9
Revises: c3d7e9a2f5b8
Create Date: 2026-08-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd4e8f1a3b6c9'
down_revision = 'c3d7e9a2f5b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "crm_products" not in existing_tables:
        op.create_table(
            "crm_products",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("model_number", sa.String(length=150), nullable=True),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column("unit", sa.String(length=50), nullable=True),
            sa.Column("default_price", sa.Float(), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )

    if "crm_payment_terms" not in existing_tables:
        op.create_table(
            "crm_payment_terms",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("label", sa.String(length=150), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())
    if "crm_payment_terms" in existing_tables:
        op.drop_table("crm_payment_terms")
    if "crm_products" in existing_tables:
        op.drop_table("crm_products")

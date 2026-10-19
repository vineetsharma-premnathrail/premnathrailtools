"""Store: multi-line stock entry documents with attachments.

Revision ID: a4d8f2b6c9e1
Revises: f2c6e8a4b1d7
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "a4d8f2b6c9e1"
down_revision = "f2c6e8a4b1d7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "store_stock_entries" not in tables:
        op.create_table(
            "store_stock_entries",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("entry_number", sa.String(50), nullable=False, unique=True, index=True),
            sa.Column("entry_type", sa.String(50), nullable=False),
            sa.Column("location_id", sa.Integer(), sa.ForeignKey("store_locations.id"), nullable=False),
            sa.Column("entry_date", sa.Date(), nullable=False),
            sa.Column("vendor_name", sa.String(255), nullable=True),
            sa.Column("invoice_number", sa.String(100), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if "store_stock_entry_attachments" not in tables:
        op.create_table(
            "store_stock_entry_attachments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("entry_id", sa.Integer(), sa.ForeignKey("store_stock_entries.id"), nullable=False, index=True),
            sa.Column("file_name", sa.String(255), nullable=False),
            sa.Column("file_path", sa.String(1000), nullable=False),
            sa.Column("content_type", sa.String(150), nullable=True),
            sa.Column("file_size", sa.Integer(), nullable=True),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("store_stock_entry_attachments")
    op.drop_table("store_stock_entries")

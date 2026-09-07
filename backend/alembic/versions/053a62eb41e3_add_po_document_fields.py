"""add po document fields

Revision ID: 053a62eb41e3
Revises: d1e3f5a7b9c2
Create Date: 2026-09-07 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '053a62eb41e3'
down_revision = 'd1e3f5a7b9c2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("p2p_purchase_orders")}

    with op.batch_alter_table("p2p_purchase_orders") as batch_op:
        if "document_filename" not in columns:
            batch_op.add_column(sa.Column("document_filename", sa.String(length=255), nullable=True))
        if "document_content_type" not in columns:
            batch_op.add_column(sa.Column("document_content_type", sa.String(length=255), nullable=True))
        if "document_size" not in columns:
            batch_op.add_column(sa.Column("document_size", sa.Integer(), nullable=True))
        if "document_sharepoint_path" not in columns:
            batch_op.add_column(sa.Column("document_sharepoint_path", sa.String(length=1000), nullable=True))
        if "document_sharepoint_url" not in columns:
            batch_op.add_column(sa.Column("document_sharepoint_url", sa.String(length=1000), nullable=True))
        if "document_uploaded_by_id" not in columns:
            batch_op.add_column(sa.Column("document_uploaded_by_id", sa.Integer(), nullable=True))
        if "document_uploaded_at" not in columns:
            batch_op.add_column(sa.Column("document_uploaded_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("p2p_purchase_orders") as batch_op:
        batch_op.drop_column("document_uploaded_at")
        batch_op.drop_column("document_uploaded_by_id")
        batch_op.drop_column("document_sharepoint_url")
        batch_op.drop_column("document_sharepoint_path")
        batch_op.drop_column("document_size")
        batch_op.drop_column("document_content_type")
        batch_op.drop_column("document_filename")

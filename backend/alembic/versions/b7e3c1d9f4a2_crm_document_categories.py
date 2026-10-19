"""CRM: document categories master (managed in CRM › Settings › Lists).

Seeds the categories that were hard-coded in the upload picker until now.

Revision ID: b7e3c1d9f4a2
Revises: a4d8f2b6c9e1
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "b7e3c1d9f4a2"
down_revision = "a4d8f2b6c9e1"
branch_labels = None
depends_on = None

DEFAULTS = [
    "RFQ", "Tender Notice", "BOQ", "Technical Specifications", "Drawings", "Cost Sheet",
    "Quotation", "Purchase Documents", "Approval Documents", "Other",
]


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "crm_document_categories" in tables:
        return
    table = op.create_table(
        "crm_document_categories",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.bulk_insert(table, [{"label": label, "is_deleted": False} for label in DEFAULTS])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "crm_document_categories" in tables:
        op.drop_table("crm_document_categories")

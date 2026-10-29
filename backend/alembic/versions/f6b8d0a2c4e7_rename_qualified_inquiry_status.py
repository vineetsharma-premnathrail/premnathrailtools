"""Inquiry status 'Qualified' renamed to 'Qualified Inquiry' (owner, 2026-10-28).

Updates the status text on existing inquiries; the stage it maps to
('Requirement Qualified') is unchanged.

Revision ID: f6b8d0a2c4e7
Revises: b30482f9e048
"""
from alembic import op

revision = "f6b8d0a2c4e7"
down_revision = "b30482f9e048"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE crm_inquiries SET status = 'Qualified Inquiry' WHERE status = 'Qualified'")


def downgrade():
    op.execute("UPDATE crm_inquiries SET status = 'Qualified' WHERE status = 'Qualified Inquiry'")

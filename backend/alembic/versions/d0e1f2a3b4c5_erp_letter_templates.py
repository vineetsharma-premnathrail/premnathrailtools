"""ERP project letters: templated delivery documents

Adds letter_type (general | delivery_cover | delivery_confirmation |
guarantee_certificate) and a JSON `data` column holding each template's
structured fields (LOA, invoice, challan lines, document list, ...).

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa

revision = "d0e1f2a3b4c5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("erp_project_letters")}
    if "letter_type" not in cols:
        op.add_column("erp_project_letters", sa.Column("letter_type", sa.String(length=40), nullable=False, server_default="general"))
    if "data" not in cols:
        op.add_column("erp_project_letters", sa.Column("data", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("erp_project_letters", "data")
    op.drop_column("erp_project_letters", "letter_type")
